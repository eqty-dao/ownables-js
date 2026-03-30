import type TypedDict from '../types/TypedDict';
import type {
  CosmWasmEvent,
  CosmWasmMessageInfo,
  OwnableRPC,
  StateDump,
} from '../types/OwnableRuntime';
import { decode, encode } from 'cbor-x';

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

export default class WorkerRPC implements OwnableRPC {
  private worker!: Worker;
  private readonly ownableId: string;
  private widgetWindow: Window | null = null;
  private _queue: Promise<any> = Promise.resolve();

  constructor(id: string) {
    this.ownableId = id;
  }

  private wrapWorkerError(context: string, err: unknown): Error {
    if (err instanceof Error) return err;

    if (typeof ErrorEvent !== 'undefined' && err instanceof ErrorEvent) {
      const parts = [
        context,
        err.message || 'worker script error',
        err.filename ? `at ${err.filename}:${err.lineno}:${err.colno}` : '',
      ].filter(Boolean);
      const wrapped = new Error(parts.join(' '));
      (wrapped as any).cause = err;
      return wrapped;
    }

    if (typeof MessageEvent !== 'undefined' && err instanceof MessageEvent) {
      const wrapped = new Error(`${context}: worker message deserialization error`);
      (wrapped as any).cause = err;
      return wrapped;
    }

    if (err instanceof Event) {
      const eventLike = err as any;
      const details = [
        eventLike?.message,
        eventLike?.filename
          ? `at ${eventLike.filename}:${eventLike.lineno ?? '?'}:${eventLike.colno ?? '?'}`
          : '',
      ]
        .filter((v) => typeof v === 'string' && v.trim() !== '')
        .join(' ');
      const wrapped = new Error(
        `${context}: worker emitted ${err.type} event${details ? ` (${details})` : ''}`
      );
      (wrapped as any).cause = err;
      return wrapped;
    }

    const wrapped = new Error(`${context}: ${String(err)}`);
    (wrapped as any).cause = err;
    return wrapped;
  }

  async initialize(js: string, wasm: Uint8Array): Promise<void> {
    return await new Promise((resolve, reject) => {
      const blob = new Blob([js], { type: 'application/javascript' });
      const blobURL = URL.createObjectURL(blob);
      this.worker = new Worker(blobURL, { type: 'module' });
      let settled = false;

      const onMessage = (event: MessageEvent<{ success?: boolean; err?: string }>) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (event.data?.err) {
          const raw = event.data.err;
          if (raw.includes('__wbindgen_placeholder__')) {
            reject(
              new Error(
                'Ownable package is incompatible with this runtime (wasm-bindgen imports detected). Rebuild and re-import the package with Host ABI v1.'
              )
            );
            return;
          }
          reject(new Error(`Ownable worker init failed: ${raw}`));
          return;
        }
        if (event.data?.success) {
          resolve();
          return;
        }
        reject(new Error('Ownable worker init failed: invalid init response'));
      };

      const onError = (event: Event) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(this.wrapWorkerError('Ownable worker init failed', event));
      };

      const onMessageError = (event: MessageEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(this.wrapWorkerError('Ownable worker init failed', event));
      };

      const cleanup = () => {
        URL.revokeObjectURL(blobURL);
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
        this.worker.removeEventListener('messageerror', onMessageError);
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.worker.addEventListener('messageerror', onMessageError);

      this.worker.postMessage({ type: 'init', wasm });
    });
  }

  setWidgetWindow(win: unknown | null): void {
    this.widgetWindow = (win as Window | null) ?? null;
  }

  terminate(): void {
    this.worker?.terminate();
  }

  private attributesToDict(attributes: Array<{ key: string; value: string }>): TypedDict<string> {
    return Object.fromEntries(attributes.map((a) => [a.key, a.value]));
  }

  private decodeEnvelope(output: ArrayBuffer | Uint8Array): WorkerPayload {
    const envelope = decode(
      output instanceof Uint8Array ? output : new Uint8Array(output)
    ) as HostAbiEnvelope;

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
    const call = () =>
      new Promise<{ response: Uint8Array; state: StateDump }>((resolve, reject) => {
        if (!this.worker) {
          reject(new Error(`Unable to ${type}: not initialized`));
          return;
        }
        let settled = false;

        const onMessage = (
          event: MessageEvent<{ output?: ArrayBuffer | Uint8Array; err?: string }>
        ) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (event.data?.err) {
            reject(new Error(`Ownable ${type} failed: ${event.data.err}`));
            return;
          }

          if (!event.data?.output) {
            reject(new Error(`Ownable ${type} failed: empty worker output`));
            return;
          }

          try {
            const decoded = this.decodeEnvelope(event.data.output);
            const nextState = decoded.mem?.state_dump ?? state;
            resolve({ response: decoded.result as Uint8Array, state: nextState || [] });
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };

        const onError = (event: Event) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(this.wrapWorkerError(`Ownable ${type} failed`, event));
        };

        const onMessageError = (event: MessageEvent) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(this.wrapWorkerError(`Ownable ${type} failed`, event));
        };

        const cleanup = () => {
          this.worker.removeEventListener('message', onMessage);
          this.worker.removeEventListener('error', onError);
          this.worker.removeEventListener('messageerror', onMessageError);
        };

        this.worker.addEventListener('message', onMessage);
        this.worker.addEventListener('error', onError);
        this.worker.addEventListener('messageerror', onMessageError);

        const input = encode(request);
        this.worker.postMessage({ type, input });
      });

    const next = this._queue.then(call, call);
    this._queue = next.catch(() => {});
    return next;
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

  private async queryRaw(msg: TypedDict, state: StateDump): Promise<Uint8Array> {
    return (await this.workerCall('query', { msg, mem: { state_dump: state } }, state)).response;
  }

  async query(msg: TypedDict, state: StateDump): Promise<any> {
    const bytes = await this.queryRaw(msg, state);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async refresh(state: StateDump): Promise<void> {
    if (!this.widgetWindow) return;
    const widgetState = await this.query({ get_widget_state: {} }, state);
    this.widgetWindow.postMessage({ ownable_id: this.ownableId, state: widgetState }, '*');
  }
}
