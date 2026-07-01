import type EventChainService from "./EventChain.service.js";
import type OwnableService from "./Ownable.service.js";
import type { EventChain } from "eqty-core";
import type {
  IndexedPublicEvent,
  IndexedPublicReplaySelectionOptions,
  ReplayAuthorityEvaluateInput,
  ReplayAuthorityEvaluateResult,
  ReplayDedupedEvents,
  ReplayIgnoredPublicEvent,
  ReplayFreshnessResult,
} from "../types/Replay.js";

function replaySort(a: IndexedPublicEvent, b: IndexedPublicEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
  return a.logIndex - b.logIndex;
}

export function publicEventReplayKey(event: Pick<IndexedPublicEvent, "transactionHash" | "logIndex">): string {
  return `${event.transactionHash}:${event.logIndex}`;
}

export function dedupeIndexedPublicEvents(events: IndexedPublicEvent[]): ReplayDedupedEvents {
  const sorted = [...events].sort(replaySort);
  const seen = new Set<string>();
  const deduped: IndexedPublicEvent[] = [];
  const duplicateReplayKeys: string[] = [];
  const duplicateEvents: IndexedPublicEvent[] = [];

  for (const event of sorted) {
    const key = publicEventReplayKey(event);
    if (seen.has(key)) {
      duplicateReplayKeys.push(key);
      duplicateEvents.push(event);
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }

  return { events: deduped, duplicateReplayKeys, duplicateEvents };
}

export function evaluateReplayFreshness(
  indexedEvents: IndexedPublicEvent[],
  appliedReplayKeys: Iterable<string>
): ReplayFreshnessResult {
  const applied = new Set(appliedReplayKeys);
  const deduped = dedupeIndexedPublicEvents(indexedEvents).events;
  const missingReplayKeys = deduped
    .map((event) => publicEventReplayKey(event))
    .filter((key) => !applied.has(key));

  const latestEvent = deduped.at(-1);
  return {
    stale: missingReplayKeys.length > 0,
    missingReplayKeys,
    ...(latestEvent ? { latestReplayKey: publicEventReplayKey(latestEvent) } : {}),
  };
}

function resolvePrefixBoundaryTimestamps(
  options: IndexedPublicReplaySelectionOptions
): { lowerBound?: number; upperBound?: number; usedTimestampFallback: boolean } | null {
  const { privateEvents, privatePrefixLength, anchorValidation, mode = "production" } = options;
  const prefixIndex = privatePrefixLength - 1;
  const nextIndex = privatePrefixLength;

  const lowerPrivateEvent = prefixIndex >= 0 ? privateEvents[prefixIndex] : undefined;
  const nextPrivateEvent = nextIndex < privateEvents.length ? privateEvents[nextIndex] : undefined;
  const anchorDetails = anchorValidation?.details ?? {};
  const lowerAnchoredAt = lowerPrivateEvent ? anchorDetails[lowerPrivateEvent.hash]?.timestamp : undefined;
  const nextAnchoredAt = nextPrivateEvent ? anchorDetails[nextPrivateEvent.hash]?.timestamp : undefined;

  if (privatePrefixLength === 0) {
    return nextAnchoredAt === undefined
      ? { usedTimestampFallback: false }
      : { upperBound: nextAnchoredAt, usedTimestampFallback: false };
  }

  if (lowerAnchoredAt !== undefined) {
    return nextAnchoredAt === undefined
      ? { lowerBound: lowerAnchoredAt, usedTimestampFallback: false }
      : { lowerBound: lowerAnchoredAt, upperBound: nextAnchoredAt, usedTimestampFallback: false };
  }

  const hasAnyAnchors = Object.values(anchorDetails).some((detail) => detail.transactionHash);
  if (hasAnyAnchors || mode !== "development") {
    return null;
  }

  const lowerTimestamp = lowerPrivateEvent?.timestamp;
  const upperTimestamp = nextPrivateEvent?.timestamp;
  if (lowerTimestamp === undefined || (nextPrivateEvent && upperTimestamp === undefined)) {
    return null;
  }

  return upperTimestamp === undefined
    ? { lowerBound: lowerTimestamp, usedTimestampFallback: true }
    : { lowerBound: lowerTimestamp, upperBound: upperTimestamp, usedTimestampFallback: true };
}

export function selectReplayableIndexedPublicEvents(
  indexedEvents: IndexedPublicEvent[],
  options: IndexedPublicReplaySelectionOptions
): { events: IndexedPublicEvent[]; ignoredPublicEvents: ReplayIgnoredPublicEvent[] } {
  const { events } = dedupeIndexedPublicEvents(indexedEvents);
  const boundaries = resolvePrefixBoundaryTimestamps(options);
  if (!boundaries) {
    return {
      events: [],
      ignoredPublicEvents: events.map((event) => ({
        replayKey: publicEventReplayKey(event),
        event,
        reason: "missing_private_prefix",
        cause: {
          privatePrefixLength: options.privatePrefixLength,
          mode: options.mode ?? "production",
        },
      })),
    };
  }

  const replayable: IndexedPublicEvent[] = [];
  const ignoredPublicEvents: ReplayIgnoredPublicEvent[] = [];

  for (const event of events) {
    const replayKey = publicEventReplayKey(event);
    if (event.timestamp === undefined) {
      ignoredPublicEvents.push({
        replayKey,
        event,
        reason: "missing_public_timestamp",
        cause: {
          privatePrefixLength: options.privatePrefixLength,
          usedTimestampFallback: boundaries.usedTimestampFallback,
        },
      });
      continue;
    }

    if (boundaries.lowerBound !== undefined && event.timestamp < boundaries.lowerBound) {
      ignoredPublicEvents.push({
        replayKey,
        event,
        reason: "missing_private_prefix",
        cause: {
          privatePrefixLength: options.privatePrefixLength,
          usedTimestampFallback: boundaries.usedTimestampFallback,
        },
      });
      continue;
    }

    if (boundaries.upperBound !== undefined && event.timestamp >= boundaries.upperBound) {
      ignoredPublicEvents.push({
        replayKey,
        event,
        reason: "missing_private_prefix",
        cause: {
          privatePrefixLength: options.privatePrefixLength,
          usedTimestampFallback: boundaries.usedTimestampFallback,
        },
      });
      continue;
    }

    replayable.push(event);
  }

  return {
    events: replayable,
    ignoredPublicEvents,
  };
}

export interface ReplayAuthorityServiceDeps {
  eventChains: EventChainService;
  ownables: OwnableService;
}

function privateEventsFromChain(chain: EventChain): IndexedPublicReplaySelectionOptions["privateEvents"] {
  return chain.events.map((event: any) => ({
    hash: event.hash?.hex ?? event.hash,
    ...(typeof event.timestamp === "number" ? { timestamp: event.timestamp } : {}),
  }));
}

export class ReplayAuthorityService {
  constructor(private readonly deps: ReplayAuthorityServiceDeps) {}

  async evaluate(input: ReplayAuthorityEvaluateInput): Promise<ReplayAuthorityEvaluateResult> {
    const anchorVerification = await this.deps.eventChains.verify(input.chain, input.anchorEvidence);
    const replayOptions = input.replayContext
      ? {
          privateEvents: privateEventsFromChain(input.chain),
          privatePrefixLength: input.replayContext.privatePrefixLength,
          anchorValidation: anchorVerification,
          ...(input.replayContext.mode ? { mode: input.replayContext.mode } : {}),
        }
      : undefined;
    const replay = await this.deps.ownables.attemptReplayIndexedPublicEvents(
      input.chain.id,
      input.stateDump,
      input.indexedPublicEvents,
      replayOptions
    );
    const freshness = evaluateReplayFreshness(input.indexedPublicEvents, replay.appliedReplayKeys);
    const ownableInfo = await this.deps.ownables.rpc(input.chain.id).query({ get_info: {} }, replay.stateDump);

    return {
      anchorVerification,
      replay,
      freshness,
      owner: ownableInfo.owner,
      ownableInfo,
    };
  }
}
