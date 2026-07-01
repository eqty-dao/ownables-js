import type { PublicEvent } from "./OwnableRuntime.js";
import type { TypedOwnableInfo } from "./TypedOwnableInfo.js";
import type { EventChain } from "eqty-core";
import type { AnchorValidationResult, IndexedAnchorRecord } from "./AnchorValidation.js";

export interface IndexedPublicEvent extends PublicEvent {
  indexedAt?: string;
}

export interface ReplayDedupedEvents {
  events: IndexedPublicEvent[];
  duplicateReplayKeys: string[];
  duplicateEvents: IndexedPublicEvent[];
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
  appliedPublicEvents: ReplayEventMetadata[];
  duplicatePublicEvents: ReplayEventMetadata[];
}

export interface ReplayEventMetadata {
  replayKey: string;
  event: IndexedPublicEvent;
}

export interface ReplayIgnoredPublicEvent extends ReplayEventMetadata {
  reason: "register_failed" | "missing_private_prefix" | "missing_public_timestamp";
  cause: unknown;
}

export interface ReplayAttemptResult extends ReplayAppliedResult {
  complete: boolean;
  ignoredPublicEvents: ReplayIgnoredPublicEvent[];
}

export interface ReplayAuthorityEvaluateInput {
  chain: EventChain;
  stateDump: Array<[ArrayLike<number>, ArrayLike<number>]>;
  indexedPublicEvents: IndexedPublicEvent[];
  anchorEvidence?: ReplayAuthorityAnchorEvidence;
  replayContext?: ReplayAuthorityReplayContext;
}

export interface ReplayAuthorityEvaluateResult {
  anchorVerification: AnchorValidationResult;
  replay: ReplayAttemptResult;
  freshness: ReplayFreshnessResult;
  owner: string;
  ownableInfo: TypedOwnableInfo;
}

export interface ReplayPrivateEventBoundary {
  hash: string;
  timestamp?: number;
}

export interface ReplayAuthorityAnchorEvidence {
  indexedRecords: IndexedAnchorRecord[];
}

export interface ReplayAuthorityReplayContext {
  privatePrefixLength: number;
  mode?: "production" | "development";
}

export interface IndexedPublicReplaySelectionOptions {
  privateEvents: ReplayPrivateEventBoundary[];
  privatePrefixLength: number;
  anchorValidation?: AnchorValidationResult;
  mode?: "production" | "development";
}
