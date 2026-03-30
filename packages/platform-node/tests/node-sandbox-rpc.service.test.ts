import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from 'cbor-x';

import NodeSandboxOwnableRPC from '../src/services/NodeSandboxOwnableRPC.service';

type StateDump = Array<[ArrayLike<number>, ArrayLike<number>]>;

function packPtrLen(ptr: number, len: number): bigint {
  return (BigInt(len >>> 0) << 32n) | BigInt(ptr >>> 0);
}

function buildMockExports() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let heapTop = 4096;
  let stateDump: StateDump = [];

  const alloc = (len: number): number => {
    const ptr = heapTop;
    heapTop += Math.max(len, 1);
    return ptr;
  };

  const free = vi.fn((_ptr: number, _len: number) => {});

  const readInput = (ptr: number, len: number): Uint8Array =>
    new Uint8Array(memory.buffer, ptr, len).slice();

  const writeOutput = (bytes: Uint8Array): bigint => {
    const ptr = alloc(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return packPtrLen(ptr, bytes.length);
  };

  const makeEnvelope = (payload: unknown): bigint => {
    const encoded = encode({
      success: true,
      payload: encode(payload),
    }) as Uint8Array;
    return writeOutput(encoded);
  };

  const ownable_instantiate = vi.fn((ptr: number, len: number) => {
    const request = decode(readInput(ptr, len)) as any;
    stateDump = [[[1], [2]]];
    return makeEnvelope({
      result: encode({
        attributes: [{ key: 'method', value: 'instantiate' }, { key: 'sender', value: request.info.sender }],
      }),
      mem: { state_dump: stateDump },
    });
  });

  const ownable_execute = vi.fn((ptr: number, len: number) => {
    const request = decode(readInput(ptr, len)) as any;
    stateDump = [...request.mem.state_dump, [[3], [4]]];
    return makeEnvelope({
      result: encode({
        attributes: [{ key: 'method', value: 'execute' }],
        events: [{ type: 'execute', attributes: [{ key: 'action', value: Object.keys(request.msg)[0] }] }],
        data: 'ok',
      }),
      mem: { state_dump: stateDump },
    });
  });

  const ownable_external_event = vi.fn((ptr: number, len: number) => {
    const request = decode(readInput(ptr, len)) as any;
    stateDump = [...request.mem.state_dump, [[5], [6]]];
    return makeEnvelope({
      result: encode({
        attributes: [{ key: 'method', value: 'external' }],
        events: [{ type: 'external_event', attributes: [{ key: 'id', value: request.ownable_id }] }],
        data: 'ext',
      }),
      mem: { state_dump: stateDump },
    });
  });

  const ownable_query = vi.fn((_ptr: number, _len: number) => {
    const resultBytes = Uint8Array.from(Buffer.from(JSON.stringify({ owner: 'alice' }), 'utf8'));
    return makeEnvelope({ result: resultBytes });
  });

  return {
    exports: {
      memory,
      ownable_alloc: alloc,
      ownable_free: free,
      ownable_instantiate,
      ownable_execute,
      ownable_query,
      ownable_external_event,
    },
    spies: { ownable_instantiate, ownable_execute, ownable_external_event, ownable_query, free },
  };
}

describe('NodeSandboxOwnableRPC', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes wasm and executes instantiate/execute/external/query flow', async () => {
    const mock = buildMockExports();
    vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ exports: mock.exports } as any);

    const rpc = new NodeSandboxOwnableRPC('ownable-1');
    await rpc.initialize('', Uint8Array.from([0, 97, 115, 109]));

    const instantiate = await rpc.instantiate(
      { ownable_id: 'ownable-1', package: 'cid-1', network_id: 84532 },
      { sender: 'alice', funds: [] }
    );
    expect(instantiate.attributes.method).toBe('instantiate');
    expect(instantiate.attributes.sender).toBe('alice');
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
    expect(mock.spies.ownable_query).toHaveBeenCalled();
  });

  it('throws when methods are called before initialize', async () => {
    const rpc = new NodeSandboxOwnableRPC('ownable-1');
    await expect(
      rpc.instantiate({ ownable_id: 'x', package: 'y', network_id: 1 }, { sender: 'alice', funds: [] })
    ).rejects.toThrow('not initialized');
  });

  it('throws for invalid wasm exports', async () => {
    vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ exports: { memory: new WebAssembly.Memory({ initial: 1 }) } } as any);

    const rpc = new NodeSandboxOwnableRPC('ownable-1');
    await expect(rpc.initialize('', Uint8Array.from([0, 97, 115, 109]))).rejects.toThrow('Invalid ownable runtime exports');
  });

  it('supports terminate and widget methods', async () => {
    const mock = buildMockExports();
    vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ exports: mock.exports } as any);

    const rpc = new NodeSandboxOwnableRPC('ownable-1');
    await rpc.initialize('', Uint8Array.from([0, 97, 115, 109]));
    rpc.setWidgetWindow({} as any);
    rpc.terminate();

    await expect(
      rpc.instantiate({ ownable_id: 'x', package: 'y', network_id: 1 }, { sender: 'alice', funds: [] })
    ).rejects.toThrow('not initialized');
  });
});
