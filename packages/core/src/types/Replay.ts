import type { PublicEvent } from "./OwnableRuntime";
import type { TypedOwnableInfo } from "./TypedOwnableInfo";
import type { EventChain } from "eqty-core";

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

export interface ReplayAppliedResult {
  stateDump: Array<[ArrayLike<number>, ArrayLike<number>]>;
  appliedEvents: IndexedPublicEvent[];
  appliedReplayKeys: string[];
  duplicateReplayKeys: string[];
}

export interface ReplayAuthorityEvaluateInput {
  chain: EventChain;
  stateDump: Array<[ArrayLike<number>, ArrayLike<number>]>;
  indexedPublicEvents: IndexedPublicEvent[];
}

export interface ReplayAuthorityEvaluateResult {
  anchorVerification: unknown;
  replay: ReplayAppliedResult;
  freshness: ReplayFreshnessResult;
  owner: string;
  ownableInfo: TypedOwnableInfo;
}
