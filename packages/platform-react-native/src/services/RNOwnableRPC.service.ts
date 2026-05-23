import { decode, encode } from 'cbor-x';
import type {
  CosmWasmEvent,
  CosmWasmMessageInfo,
  OwnableEvent,
  OwnableRPC,
  PublicEvent,
  RuntimePublicEvent,
  StateDump,
} from '@ownables/core';
import type TypedDict from '@ownables/core/types/TypedDict';
import type { RNOwnableRPCOptions, RNAbiCallType } from '../types/PlatformReactNative';

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

const textDecoder = new TextDecoder();

export default class RNOwnableRPC implements OwnableRPC {
  private instanceId: string | null = null;
  private initialized = false;
  private widgetWindow: unknown | null = null;
  private _queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ownableId: string,
    private readonly options: RNOwnableRPCOptions
  ) {}

  private ensureInitialized(): string {
    if (!this.initialized || !this.instanceId) {
      throw new Error('Ownable runtime not initialized');
    }

    return this.instanceId;
  }

  async initialize(_js: string, wasm: Uint8Array): Promise<void> {
    const instanceId = await this.options.bridge.createInstance(this.ownableId);
    await this.options.bridge.loadWasm(instanceId, wasm);

    this.instanceId = instanceId;
    this.initialized = true;
  }

  setWidgetWindow(win: unknown | null): void {
    this.widgetWindow = win;
  }

  terminate(): void {
    const instanceId = this.instanceId;
    this.initialized = false;
    this.instanceId = null;
    this.widgetWindow = null;

    if (instanceId) {
      void this.options.bridge.disposeInstance(instanceId);
    }
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
    type: RNAbiCallType,
    request: TypedDict,
    state?: StateDump
  ): Promise<{ response: Uint8Array; state: StateDump }> {
    const call = async () => {
      const instanceId = this.ensureInitialized();
      const input = encode(request) as Uint8Array;
      const output = await this.options.bridge.call(instanceId, type, input);
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

  private async payloadCall(type: RNAbiCallType, request: TypedDict): Promise<Uint8Array> {
    const instanceId = this.ensureInitialized();
    const input = encode(request) as Uint8Array;
    const output = await this.options.bridge.call(instanceId, type, input);
    const envelope = decode(output) as HostAbiEnvelope;

    if (!envelope.success) {
      throw new Error(
        `Ownable ABI call failed: ${envelope.error_code || 'UNKNOWN'} ${envelope.error_message || ''}`.trim()
      );
    }

    return envelope.payload ?? new Uint8Array();
  }

  private attributesToDict(attributes: Array<{ key: string; value: string }>): TypedDict<string> {
    return Object.fromEntries(attributes.map((attribute) => [attribute.key, attribute.value]));
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
      events: (response.events || []).map((event) => ({
        type: event.type,
        attributes: this.attributesToDict(event.attributes),
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

  async register(
    event: RuntimePublicEvent,
    info: CosmWasmMessageInfo,
    state: StateDump
  ): Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }> {
    const { response, state: newState } = await this.workerCall(
      'register',
      {
        msg: event,
        info,
        mem: { state_dump: state },
      },
      state
    );

    return this.toExecuteResult(decode(response) as AbiResponse, newState);
  }

  async ingest(
    event: OwnableEvent,
    info: CosmWasmMessageInfo,
    state: StateDump
  ): Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }> {
    const { response, state: newState } = await this.workerCall(
      'ingest',
      {
        msg: event,
        info,
        mem: { state_dump: state },
      },
      state
    );

    return this.toExecuteResult(decode(response) as AbiResponse, newState);
  }

  async encodePublicEvent(eventType: string, payload: Uint8Array): Promise<Uint8Array> {
    return this.payloadCall('encode_public_event', { eventType, data: payload });
  }

  async query(msg: TypedDict, state: StateDump): Promise<unknown> {
    const { response } = await this.workerCall('query', { msg, mem: { state_dump: state } }, state);
    return JSON.parse(textDecoder.decode(response));
  }

  async refresh(_state: StateDump): Promise<void> {
    // Runtime refresh is controlled by native/widget integration.
  }
}
