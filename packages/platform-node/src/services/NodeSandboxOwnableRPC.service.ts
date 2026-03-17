import vm from 'node:vm';
import { transformSync } from '@babel/core';
// @ts-expect-error - package has no shipped types
import removeImportExport from 'babel-plugin-remove-import-export';
import type { CosmWasmEvent, CosmWasmMessageInfo, OwnableRPC, StateDump } from '@ownables/core';
import type TypedDict from '@ownables/core/types/TypedDict';
import transformImportMetaUrl from '../babel/transformImportMetaUrl';
import type { NodeSandboxOptions } from '../types/PlatformNode';

type SandboxResult = Map<string, unknown>;

type SandboxDict = {
  [key: string]: unknown;
  mem: { state_dump: StateDump };
  result?: unknown;
};

function attributesToDict(attributes: Array<{ key: string; value: unknown }>): TypedDict {
  return Object.fromEntries(attributes.map(({ key, value }) => [key, value]));
}

function eventsToDict(
  events: Array<{ type: string; attributes: Array<{ key: string; value: unknown }> }>
): CosmWasmEvent[] {
  return events.map(({ type, attributes }) => ({
    type,
    attributes: attributesToDict(attributes),
  }));
}

function decodeBase64Json(encoded: string): unknown {
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  return JSON.parse(json);
}

export default class NodeSandboxOwnableRPC implements OwnableRPC {
  private ownableId = '';
  private sandbox?: vm.Context;
  private stateDump: StateDump = [];
  private readonly filename: string;

  constructor(options: NodeSandboxOptions = {}) {
    this.filename = options.filename ?? '/ownable.js';
  }

  private ensureSandbox(): vm.Context {
    if (!this.sandbox) {
      throw new Error('Ownable runtime not initialized');
    }
    return this.sandbox;
  }

  private runInSandbox(call: string, context: Record<string, unknown>): unknown {
    const sandbox = this.ensureSandbox() as SandboxDict;

    for (const [key, value] of Object.entries(context)) {
      sandbox[key] = value;
    }

    try {
      vm.runInContext(`result = ${call}`, sandbox);
      return sandbox.result;
    } finally {
      for (const key of Object.keys(context)) {
        delete sandbox[key];
      }
      delete sandbox.result;
    }
  }

  private normalizeModule(js: string): string {
    const output = transformSync(js, {
      filename: this.filename,
      babelrc: false,
      configFile: false,
      plugins: [removeImportExport, transformImportMetaUrl],
    });

    if (!output?.code) {
      throw new Error('Unable to transform ownable module source');
    }

    return output.code;
  }

  private syncState(result: SandboxResult): StateDump {
    const memJson = result.get('mem');
    const mem = typeof memJson === 'string' ? JSON.parse(memJson) : { state_dump: this.stateDump };
    this.stateDump = mem.state_dump;
    return this.stateDump;
  }

  private parseStateResult(result: SandboxResult): unknown {
    const responseJson = result.has('state') ? result.get('state') : result.get('result');
    if (typeof responseJson !== 'string') {
      throw new Error('Invalid ownable runtime response');
    }
    return JSON.parse(responseJson);
  }

  async init(id: string, js: string, wasm: Uint8Array): Promise<unknown> {
    this.ownableId = id;
    this.stateDump = [];

    const sandboxObject: SandboxDict = {
      TextEncoder,
      TextDecoder,
      WebAssembly,
      Buffer,
      console,
      setTimeout,
      clearTimeout,
      URL,
      __filename: this.filename,
      mem: { state_dump: [] },
    };

    this.sandbox = vm.createContext(sandboxObject);
    const normalized = this.normalizeModule(js);
    vm.runInContext(normalized, this.sandbox);

    const initFn = this.runInSandbox(
      '(typeof __wbg_init !== "undefined" ? __wbg_init : (typeof init !== "undefined" ? init : undefined))',
      {}
    );

    if (typeof initFn !== 'function') {
      throw new Error('Unable to locate wasm init function in ownable module');
    }

    return await (initFn as (bytes: Uint8Array) => Promise<unknown>)(wasm);
  }

  async instantiate(
    msg: TypedDict,
    info: CosmWasmMessageInfo
  ): Promise<{ attributes: TypedDict<string>; state: StateDump }> {
    const payload: TypedDict = { ...msg };
    if (!('nft' in payload)) payload.nft = undefined;
    if (!('ownable_type' in payload)) payload.ownable_type = undefined;
    if (typeof payload.network_id === 'string') {
      payload.network_id = payload.network_id.charCodeAt(0);
    }

    const result = (await this.runInSandbox('instantiate_contract(msg, info)', {
      msg: payload,
      info,
    })) as SandboxResult;

    const response = this.parseStateResult(result) as {
      attributes: Array<{ key: string; value: unknown }>;
    };
    const state = this.syncState(result);

    return {
      attributes: attributesToDict(response.attributes),
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
    const result = (await this.runInSandbox('execute_contract(msg, info, mem)', {
      msg,
      info,
      mem: { state_dump: state },
    })) as SandboxResult;

    const response = this.parseStateResult(result) as {
      attributes: Array<{ key: string; value: unknown }>;
      events?: Array<{ type: string; attributes: Array<{ key: string; value: unknown }> }>;
      data: string;
    };
    const nextState = this.syncState(result);

    return {
      attributes: attributesToDict(response.attributes),
      events: eventsToDict(response.events || []),
      data: response.data,
      state: nextState,
    };
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
    const result = (await this.runInSandbox(
      'register_external_event(msg.msg, info, ownable_id, mem)',
      {
        msg,
        info,
        ownable_id: this.ownableId,
        mem: { state_dump: state },
      }
    )) as SandboxResult;

    const response = this.parseStateResult(result) as {
      attributes: Array<{ key: string; value: unknown }>;
      events?: Array<{ type: string; attributes: Array<{ key: string; value: unknown }> }>;
      data: string;
    };
    const nextState = this.syncState(result);

    return {
      attributes: attributesToDict(response.attributes),
      events: eventsToDict(response.events || []),
      data: response.data,
      state: nextState,
    };
  }

  private async queryRaw(msg: TypedDict, state: StateDump): Promise<string> {
    const result = (await this.runInSandbox('query_contract_state(msg, mem)', {
      msg,
      mem: { state_dump: state },
    })) as SandboxResult;

    const parsed = this.parseStateResult(result) as string;
    return parsed;
  }

  async query(msg: TypedDict, state: StateDump): Promise<unknown> {
    const encoded = await this.queryRaw(msg, state);
    return decodeBase64Json(encoded);
  }

  async refresh(_state: StateDump): Promise<void> {
    // Node runtime has no iframe/widget to refresh.
  }
}
