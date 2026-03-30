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
  externalEvent: (
    msg: TypedDict,
    info: TypedDict,
    state: StateDump
  ) => Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }>;
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
