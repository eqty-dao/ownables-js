import type TypedDict from './TypedDict';

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
}

export interface RuntimePublicEvent extends Omit<PublicEvent, 'data'> {
  data: Uint8Array;
}

export interface OwnableEventSource {
  id: string;
  owner: string;
  issuer: string;
}

export interface OwnableEvent {
  source: OwnableEventSource;
  eventType: string;
  attributes: TypedDict;
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
