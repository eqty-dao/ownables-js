import type { Binary, EventChain } from 'eqty-core';
import type { AnchorValidationResult } from './AnchorValidation.js';
import type { IndexedPublicEvent } from './Replay.js';
import type TypedDict from './TypedDict.js';

export type StateDump = Array<[ArrayLike<number>, ArrayLike<number>]>;

export interface CosmWasmMessageInfo {
  sender: string;
  funds: object[];
}

export interface CosmWasmEvent {
  type: string;
  attributes: TypedDict<string>;
}

export interface PublicEvent {
  source: string;
  eventType: string;
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  timestamp?: number;
}

export interface EmittedPublicEventReceipt extends PublicEvent {
  subjectId: string;
}

export interface RuntimePublicEvent extends Omit<PublicEvent, 'data' | 'transactionHash'> {
  data: Uint8Array;
  transactionHash: Binary;
}

export interface OwnableEventSource {
  id: string;
  owner: string;
  issuer: string;
}

export interface LegacyOwnableEvent {
  source: OwnableEventSource;
  eventType: string;
  attributes: TypedDict;
}

export interface ConsumeIngestEvent {
  type: 'consume';
  source: OwnableEventSource & { event: string };
  target: { id: string };
  attributes: TypedDict<string>;
}

export interface SignedConsumeIngestEvent extends ConsumeIngestEvent {
  source: ConsumeIngestEvent['source'] & { cid: string };
}

export type OwnableEvent = LegacyOwnableEvent | ConsumeIngestEvent;

export interface ConsumptionVerificationOptions {
  getAttachment(cid: string): Promise<Uint8Array | undefined>;
  putAttachment?(cid: string, bytes: Uint8Array, mediaType?: string): Promise<void>;
  verifySignature: NonNullable<Parameters<EventChain['validate']>[0]>;
  verifyAnchors(chain: EventChain): Promise<AnchorValidationResult>;
  getPublicEvents(
    chain: EventChain,
    anchors: AnchorValidationResult
  ): Promise<IndexedPublicEvent[]>;
  maxSnapshotBytes?: number;
}

export class ConsumptionEvidencePendingError extends Error {
  constructor(message = 'Missing authoritative anchor or public event evidence for consumption') {
    super(message);
    this.name = 'ConsumptionEvidencePendingError';
  }
}

export interface EventAttachmentInput {
  name: string;
  file: Blob | File;
}

export interface OwnableRPC {
  initialize: (js: string, wasm: Uint8Array) => Promise<void>;
  instantiate: (
    msg: TypedDict,
    info: CosmWasmMessageInfo
  ) => Promise<{ attributes: TypedDict<string>; state: StateDump }>;
  execute: (
    msg: TypedDict,
    info: CosmWasmMessageInfo,
    state: StateDump
  ) => Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }>;
  register: (
    event: RuntimePublicEvent,
    info: CosmWasmMessageInfo,
    state: StateDump
  ) => Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }>;
  ingest: (
    event: OwnableEvent,
    info: CosmWasmMessageInfo,
    state: StateDump
  ) => Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }>;
  encodePublicEvent: (eventType: string, payload: Uint8Array) => Promise<Uint8Array>;
  query: (msg: TypedDict, state: StateDump) => Promise<any>;
  refresh: (state: StateDump) => Promise<void>;
  terminate: () => void;
  setWidgetWindow: (win: unknown | null) => void;
}

export interface StateSnapshot {
  eventIndex: number;
  blockHash: string;
  stateDump: StateDump;
  timestamp: Date;
}
