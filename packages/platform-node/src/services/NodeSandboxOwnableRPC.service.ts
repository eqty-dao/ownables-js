import { decode, encode } from 'cbor-x';
import type { CosmWasmEvent, CosmWasmMessageInfo, OwnableRPC, StateDump } from '@ownables/core';
import type TypedDict from '@ownables/core/types/TypedDict';

type AbiExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  ownable_alloc: (len: number) => number;
  ownable_free: (ptr: number, len: number) => void;
  ownable_instantiate: (ptr: number, len: number) => bigint | number;
  ownable_execute: (ptr: number, len: number) => bigint | number;
  ownable_query: (ptr: number, len: number) => bigint | number;
  ownable_external_event: (ptr: number, len: number) => bigint | number;
};

interface HostAbiEnvelope {
  success: boolean;
  payload?: Uint8Array;
  error_code?: string;
  error_message?: string;
}

interface WorkerPayload {
  result: Uint8Array;
  mem?: { state_dump: StateDump };
}

interface AbiResponse {
  attributes: Array<{ key: string; value: string }>;
  events?: Array<{ type: string; attributes: Array<{ key: string; value: string }> }>;
  data?: string;
}

export default class NodeSandboxOwnableRPC implements OwnableRPC {
  private ownableId = '';
  private exportsRef: AbiExports | null = null;
  private memory: WebAssembly.Memory | null = null;
  private widgetWindow: unknown | null = null;
  private _queue: Promise<any> = Promise.resolve();

  constructor(id = '') {
    this.ownableId = id;
  }

  private unpackPtrLen(packed: bigint | number): { ptr: number; len: number } {
    const value = typeof packed === 'bigint' ? packed : BigInt(packed);
    const ptr = Number(value & 0xffffffffn);
    const len = Number((value >> 32n) & 0xffffffffn);
    return { ptr, len };
  }

  private ensureInitialized(): AbiExports {
    if (!this.exportsRef || !this.memory) {
      throw new Error('Ownable runtime not initialized');
    }
    return this.exportsRef;
  }

  async initialize(_js: string, wasm: Uint8Array): Promise<void> {
    const instance = (await WebAssembly.instantiate(wasm, {})) as WebAssembly.Instance;
    const exportsRef = instance.exports as AbiExports;

    if (
      !exportsRef.memory ||
      typeof exportsRef.ownable_alloc !== 'function' ||
      typeof exportsRef.ownable_free !== 'function' ||
      typeof exportsRef.ownable_instantiate !== 'function' ||
      typeof exportsRef.ownable_execute !== 'function' ||
      typeof exportsRef.ownable_query !== 'function' ||
      typeof exportsRef.ownable_external_event !== 'function'
    ) {
      throw new Error('Invalid ownable runtime exports');
    }

    this.exportsRef = exportsRef;
    this.memory = exportsRef.memory;
  }

  setWidgetWindow(win: unknown | null): void {
    this.widgetWindow = win;
  }

  terminate(): void {
    this.exportsRef = null;
    this.memory = null;
    this.widgetWindow = null;
  }

  private invoke(type: string, inputBytes: Uint8Array): Uint8Array {
    const exportsRef = this.ensureInitialized();
    const memory = this.memory as WebAssembly.Memory;

    const len = inputBytes.length >>> 0;
    const inPtr = exportsRef.ownable_alloc(len);
    if (len > 0) new Uint8Array(memory.buffer, inPtr, len).set(inputBytes);

    let packed: bigint | number;
    try {
      switch (type) {
        case 'instantiate':
          packed = exportsRef.ownable_instantiate(inPtr, len);
          break;
        case 'execute':
          packed = exportsRef.ownable_execute(inPtr, len);
          break;
        case 'query':
          packed = exportsRef.ownable_query(inPtr, len);
          break;
        case 'external_event':
          packed = exportsRef.ownable_external_event(inPtr, len);
          break;
        default:
          throw new Error(`unknown message type ${type}`);
      }
    } finally {
      exportsRef.ownable_free(inPtr, len);
    }

    const { ptr: outPtr, len: outLen } = this.unpackPtrLen(packed);
    const output =
      outLen > 0
        ? new Uint8Array(new Uint8Array(memory.buffer, outPtr, outLen))
        : new Uint8Array();

    if (outLen > 0) exportsRef.ownable_free(outPtr, outLen);
    return output;
  }

  private decodeEnvelope(output: Uint8Array): WorkerPayload {
    const envelope = decode(output) as HostAbiEnvelope;

    if (!envelope.success) {
      throw new Error(
        `Ownable ABI call failed: ${envelope.error_code || 'UNKNOWN'} ${envelope.error_message || ''}`.trim()
      );
    }

    const payload = envelope.payload ?? new Uint8Array();
    return decode(payload) as WorkerPayload;
  }

  private workerCall(
    type: string,
    request: TypedDict,
    state?: StateDump
  ): Promise<{ response: Uint8Array; state: StateDump }> {
    const call = async () => {
      const input = encode(request) as Uint8Array;
      const output = this.invoke(type, input);
      const decoded = this.decodeEnvelope(output);
      return {
        response: decoded.result,
        state: decoded.mem?.state_dump ?? state ?? [],
      };
    };

    const next = this._queue.then(call, call);
    this._queue = next.catch(() => {});
    return next;
  }

  private attributesToDict(attributes: Array<{ key: string; value: string }>): TypedDict<string> {
    return Object.fromEntries(attributes.map((a) => [a.key, a.value]));
  }

  async instantiate(
    msg: TypedDict,
    info: CosmWasmMessageInfo
  ): Promise<{ attributes: TypedDict<string>; state: StateDump }> {
    const { response, state } = await this.workerCall('instantiate', { msg, info });
    const parsed = decode(response) as AbiResponse;
    return {
      attributes: this.attributesToDict(parsed.attributes),
      state,
    };
  }

  private toExecuteResult(
    response: AbiResponse,
    state: StateDump
  ): {
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  } {
    return {
      attributes: this.attributesToDict(response.attributes),
      events: (response.events || []).map((e) => ({
        type: e.type,
        attributes: this.attributesToDict(e.attributes),
      })),
      data: response.data ?? '',
      state,
    };
  }

  async execute(
    msg: TypedDict,
    info: CosmWasmMessageInfo,
    state: StateDump
  ): Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }> {
    const { response, state: newState } = await this.workerCall(
      'execute',
      { msg, info, mem: { state_dump: state } },
      state
    );
    return this.toExecuteResult(decode(response) as AbiResponse, newState);
  }

  async externalEvent(
    msg: TypedDict,
    info: TypedDict,
    state: StateDump
  ): Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }> {
    const { response, state: newState } = await this.workerCall(
      'external_event',
      {
        msg: msg.msg,
        info,
        ownable_id: this.ownableId,
        mem: { state_dump: state },
      },
      state
    );
    return this.toExecuteResult(decode(response) as AbiResponse, newState);
  }

  async query(msg: TypedDict, state: StateDump): Promise<unknown> {
    const { response } = await this.workerCall('query', { msg, mem: { state_dump: state } }, state);
    return JSON.parse(Buffer.from(response).toString('utf8'));
  }

  async refresh(_state: StateDump): Promise<void> {
    // Node runtime has no widget window refresh target.
  }
}
