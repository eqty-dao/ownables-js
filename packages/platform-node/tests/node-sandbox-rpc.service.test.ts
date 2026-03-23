import { describe, expect, it } from 'vitest';

import NodeSandboxOwnableRPC from '../src/services/NodeSandboxOwnableRPC.service';

const moduleJs = `
export const location = import.meta.url;

export async function init(_input) {
  globalThis.mem = { state_dump: [] };
  return { ok: true };
}

function mkResult(response, stateDump) {
  return new Map([
    ['state', JSON.stringify(response)],
    ['mem', JSON.stringify({ state_dump: stateDump })],
  ]);
}

export async function instantiate_contract(msg, info) {
  const state = [[[1], [2]]];
  return mkResult(
    {
      attributes: [
        { key: 'method', value: 'instantiate' },
        { key: 'sender', value: info.sender },
        { key: 'url', value: location },
      ],
      events: [],
      data: '',
    },
    state
  );
}

export async function execute_contract(msg, _info, mem) {
  const state = [...mem.state_dump, [[3], [4]]];
  return mkResult(
    {
      attributes: [{ key: 'method', value: 'execute' }],
      events: [
        { type: 'execute', attributes: [{ key: 'action', value: Object.keys(msg)[0] }] },
      ],
      data: 'ok',
    },
    state
  );
}

export async function register_external_event(msg, _info, ownableId, mem) {
  const state = [...mem.state_dump, [[5], [6]]];
  return mkResult(
    {
      attributes: [{ key: 'method', value: 'external' }],
      events: [
        { type: 'external_event', attributes: [{ key: 'id', value: ownableId }, { key: 'event_type', value: msg.event_type }] },
      ],
      data: 'ext',
    },
    state
  );
}

export async function query_contract_state(_msg, _mem) {
  const payload = Buffer.from(JSON.stringify({ owner: 'alice' }), 'utf8').toString('base64');
  return new Map([['result', JSON.stringify(payload)]]);
}
`;

describe('NodeSandboxOwnableRPC', () => {
  it('initializes module and executes instantiate/execute/external/query flow', async () => {
    const rpc = new NodeSandboxOwnableRPC();

    await rpc.init('ownable-1', moduleJs, Uint8Array.from([0, 97, 115, 109]));

    const instantiate = await rpc.instantiate(
      { ownable_id: 'ownable-1', package: 'cid-1', network_id: 84532 },
      { sender: 'alice', funds: [] }
    );

    expect(instantiate.attributes.method).toBe('instantiate');
    expect(instantiate.attributes.url).toBe('file:///ownable.js');
    expect(instantiate.state.length).toBe(1);

    const execute = await rpc.execute({ transfer: { to: 'bob' } }, { sender: 'alice', funds: [] }, instantiate.state);
    expect(execute.attributes.method).toBe('execute');
    expect(execute.events[0]?.attributes.action).toBe('transfer');
    expect(execute.state.length).toBe(2);

    const external = await rpc.externalEvent(
      { msg: { event_type: 'consume', attributes: {} } },
      { sender: 'alice', funds: [] },
      execute.state
    );

    expect(external.attributes.method).toBe('external');
    expect(external.events[0]?.attributes.id).toBe('ownable-1');
    expect(external.state.length).toBe(3);

    await expect(rpc.query({ get_info: {} }, external.state)).resolves.toEqual({ owner: 'alice' });
  });

  it('throws when methods are called before init', async () => {
    const rpc = new NodeSandboxOwnableRPC();
    await expect(
      rpc.instantiate({ ownable_id: 'x', package: 'y', network_id: 1 }, { sender: 'alice', funds: [] })
    ).rejects.toThrow('not initialized');
  });

  it('throws when wasm init function is missing', async () => {
    const rpc = new NodeSandboxOwnableRPC();
    await expect(
      rpc.init('ownable-2', 'export const x = 1;', Uint8Array.from([0, 97, 115, 109]))
    ).rejects.toThrow('Unable to locate wasm init function');
  });

  it('normalizes string network id and validates runtime response type', async () => {
    const rpc = new NodeSandboxOwnableRPC();
    const js = `
      export async function init() { return true; }
      export async function instantiate_contract(msg) {
        return new Map([
          ['state', JSON.stringify({ attributes: [{ key: 'network_id', value: msg.network_id }] })],
          ['mem', JSON.stringify({ state_dump: [] })],
        ]);
      }
    `;
    await rpc.init('ownable-3', js, Uint8Array.from([0, 97, 115, 109]));

    const instantiate = await rpc.instantiate(
      { ownable_id: 'o', package: 'c', network_id: 'A' },
      { sender: 'alice', funds: [] }
    );
    expect(instantiate.attributes.network_id).toBe(65);

    const rpcInvalid = new NodeSandboxOwnableRPC();
    const invalidJs = `
      export async function init() { return true; }
      export async function instantiate_contract() {
        return new Map([
          ['state', 123],
          ['mem', JSON.stringify({ state_dump: [] })],
        ]);
      }
    `;
    await rpcInvalid.init('ownable-4', invalidJs, Uint8Array.from([0, 97, 115, 109]));
    await expect(
      rpcInvalid.instantiate({ ownable_id: 'o', package: 'c', network_id: 1 }, { sender: 'alice', funds: [] })
    ).rejects.toThrow('Invalid ownable runtime response');
  });
});
