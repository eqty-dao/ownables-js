import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from 'cbor-x';

import RNOwnableRPC from '../src/services/RNOwnableRPC.service';
import { createRNRuntimeRpcProvider } from '../src/services/createRNRuntimeRpcProvider';
import type { RNRuntimeBridge } from '../src/types/PlatformReactNative';

type StateDump = Array<[ArrayLike<number>, ArrayLike<number>]>;

function createBridge() {
  let stateDump: StateDump = [];

  const bridge: RNRuntimeBridge = {
    createInstance: vi.fn((id: string) => `instance:${id}`),
    loadWasm: vi.fn(),
    disposeInstance: vi.fn(),
    call: vi.fn(async (_instanceId, type, payload) => {
      const request = decode(payload) as any;

      const envelope = (resultPayload: unknown) =>
        encode({
          success: true,
          payload: encode(resultPayload),
        }) as Uint8Array;

      if (type === 'instantiate') {
        stateDump = [[[1], [2]]];

        return envelope({
          result: encode({
            attributes: [
              { key: 'method', value: 'instantiate' },
              { key: 'sender', value: request.info.sender },
            ],
          }),
          mem: { state_dump: stateDump },
        });
      }

      if (type === 'execute') {
        stateDump = [...request.mem.state_dump, [[3], [4]]];

        return envelope({
          result: encode({
            attributes: [{ key: 'method', value: 'execute' }],
            events: [
              {
                type: 'execute',
                attributes: [{ key: 'action', value: Object.keys(request.msg)[0] }],
              },
            ],
            data: 'ok',
          }),
          mem: { state_dump: stateDump },
        });
      }

      if (type === 'register') {
        stateDump = [...request.mem.state_dump, [[5], [6]]];

        return envelope({
          result: encode({
            attributes: [{ key: 'method', value: 'register' }],
            events: [
              {
                type: 'register',
                attributes: [{ key: 'source', value: request.msg.source }],
              },
            ],
            data: 'ext',
          }),
          mem: { state_dump: stateDump },
        });
      }

      if (type === 'ingest') {
        stateDump = [...request.mem.state_dump, [[7], [8]]];

        return envelope({
          result: encode({
            attributes: [{ key: 'method', value: 'ingest' }],
            events: [
              {
                type: 'ingest',
                attributes: [{ key: 'id', value: request.msg.source.id }],
              },
            ],
            data: 'ingested',
          }),
          mem: { state_dump: stateDump },
        });
      }

      if (type === 'encode_public_event') {
        return encode({
          success: true,
          payload: Uint8Array.from([request.eventType.length, request.data.length]),
        }) as Uint8Array;
      }

      if (type === 'query') {
        return envelope({
          result: new TextEncoder().encode(JSON.stringify({ owner: 'alice' })),
        });
      }

      return encode({
        success: false,
        error_code: 'UNKNOWN',
        error_message: `Unsupported type ${String(type)}`,
      }) as Uint8Array;
    }),
  };

  return bridge;
}

describe('RNOwnableRPC', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs instantiate/execute/register/ingest/query flow through bridge', async () => {
    const bridge = createBridge();

    const rpc = new RNOwnableRPC('ownable-1', { bridge });
    await rpc.initialize('', Uint8Array.from([0, 97, 115, 109]));

    const instantiate = await rpc.instantiate(
      { ownable_id: 'ownable-1', package: 'cid-1', network_id: 84532 },
      { sender: 'alice', funds: [] }
    );
    expect(instantiate.attributes.method).toBe('instantiate');
    expect(instantiate.attributes.sender).toBe('alice');

    const execute = await rpc.execute(
      { transfer: { to: 'bob' } },
      { sender: 'alice', funds: [] },
      instantiate.state
    );
    expect(execute.attributes.method).toBe('execute');
    expect(execute.events[0]?.attributes.action).toBe('transfer');

    const registered = await rpc.register(
      {
        source: '0xsource',
        eventType: 'consume',
        data: `0x${'11'.repeat(4)}`,
        blockNumber: 1,
        transactionHash: `0x${'22'.repeat(32)}`,
        transactionIndex: 0,
        logIndex: 1,
      },
      { sender: 'alice', funds: [] },
      execute.state
    );
    expect(registered.attributes.method).toBe('register');
    expect(registered.events[0]?.attributes.source).toBe('0xsource');

    const ingested = await rpc.ingest(
      {
        source: { id: 'src-1', owner: 'owner-1', issuer: 'issuer-1' },
        eventType: 'consume',
        attributes: {},
      },
      { sender: 'alice', funds: [] },
      registered.state
    );
    expect(ingested.attributes.method).toBe('ingest');
    expect(ingested.events[0]?.attributes.id).toBe('src-1');

    await expect(rpc.encodePublicEvent('consume', Uint8Array.from([1, 2, 3]))).resolves.toEqual(
      Uint8Array.from([7, 3])
    );

    await expect(rpc.query({ get_info: {} }, ingested.state)).resolves.toEqual({ owner: 'alice' });
    expect(bridge.call).toHaveBeenCalled();
  });

  it('throws when called before initialize', async () => {
    const rpc = new RNOwnableRPC('ownable-1', { bridge: createBridge() });

    await expect(
      rpc.instantiate(
        { ownable_id: 'ownable-1', package: 'cid-1', network_id: 1 },
        { sender: 'alice', funds: [] }
      )
    ).rejects.toThrow('not initialized');
  });

  it('throws on failed ABI envelope', async () => {
    const bridge: RNRuntimeBridge = {
      createInstance: vi.fn(() => 'instance:1'),
      loadWasm: vi.fn(),
      disposeInstance: vi.fn(),
      call: vi.fn(() =>
        encode({ success: false, error_code: 'E_EXEC', error_message: 'boom' }) as Uint8Array
      ),
    };

    const rpc = new RNOwnableRPC('ownable-1', { bridge });
    await rpc.initialize('', Uint8Array.from([0, 97, 115, 109]));

    await expect(rpc.query({ get_info: {} }, [])).rejects.toThrow('Ownable ABI call failed: E_EXEC boom');
  });

  it('disposes runtime on terminate', async () => {
    const bridge = createBridge();

    const rpc = new RNOwnableRPC('ownable-1', { bridge });
    await rpc.initialize('', Uint8Array.from([0, 97, 115, 109]));
    rpc.terminate();

    expect(bridge.disposeInstance).toHaveBeenCalledWith('instance:ownable-1');
    await expect(
      rpc.instantiate(
        { ownable_id: 'ownable-1', package: 'cid-1', network_id: 1 },
        { sender: 'alice', funds: [] }
      )
    ).rejects.toThrow('not initialized');
  });

  it('creates rpc through provider factory', async () => {
    const bridge = createBridge();
    const provider = createRNRuntimeRpcProvider({ bridge });
    const rpc = provider.create('ownable-factory');

    await rpc.initialize('', Uint8Array.from([0, 97, 115, 109]));
    await expect(rpc.query({ get_info: {} }, [])).resolves.toEqual({ owner: 'alice' });
  });
});
