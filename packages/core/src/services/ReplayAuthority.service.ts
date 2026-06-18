import type EventChainService from "./EventChain.service.js";
import type OwnableService from "./Ownable.service.js";
import type {
  IndexedPublicEvent,
  ReplayAuthorityEvaluateInput,
  ReplayAuthorityEvaluateResult,
  ReplayDedupedEvents,
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

  for (const event of sorted) {
    const key = publicEventReplayKey(event);
    if (seen.has(key)) {
      duplicateReplayKeys.push(key);
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }

  return { events: deduped, duplicateReplayKeys };
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

export interface ReplayAuthorityServiceDeps {
  eventChains: EventChainService;
  ownables: OwnableService;
}

export class ReplayAuthorityService {
  constructor(private readonly deps: ReplayAuthorityServiceDeps) {}

  async evaluate(input: ReplayAuthorityEvaluateInput): Promise<ReplayAuthorityEvaluateResult> {
    const anchorVerification = await this.deps.eventChains.verify(input.chain);
    const replay = await this.deps.ownables.attemptReplayIndexedPublicEvents(
      input.chain.id,
      input.stateDump,
      input.indexedPublicEvents
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
