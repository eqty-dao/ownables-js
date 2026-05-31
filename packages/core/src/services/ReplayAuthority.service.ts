import type { IndexedPublicEvent, ReplayDedupedEvents, ReplayFreshnessResult } from "../types/Replay";

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
