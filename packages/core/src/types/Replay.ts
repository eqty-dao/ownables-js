import type { PublicEvent } from "./OwnableRuntime";

export interface IndexedPublicEvent extends PublicEvent {
  indexedAt?: string;
}

export interface ReplayDedupedEvents {
  events: IndexedPublicEvent[];
  duplicateReplayKeys: string[];
}

export interface ReplayFreshnessResult {
  stale: boolean;
  missingReplayKeys: string[];
  latestReplayKey?: string;
}
