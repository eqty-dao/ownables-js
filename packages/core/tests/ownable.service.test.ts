import { describe, expect, it, vi } from 'vitest';
import { Binary, EventChain } from 'eqty-core';

import OwnableService from '../src/services/Ownable.service';

const basePkg = {
  title: 'Pkg',
  name: 'pkg',
  cid: 'cid-1',
  versions: [{ date: new Date(), cid: 'cid-1' }],
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  isConsumable: false,
  isConsumer: false,
  isTransferable: false,
};

describe('OwnableService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (...args: any[]) =>
    new OwnableService(
      args[0],
      args[1],
      args[2],
      args[3],
      args[4],
      args[5] ?? (logger as any),
      args[6]
    );

  const createStateStore = () => {
    const stores = new Map<string, Map<string, any>>();
    const ensure = (store: string) => {
      if (!stores.has(store)) stores.set(store, new Map());
      return stores.get(store)!;
    };
    return {
      get: vi.fn(async (store: string, key: string) => stores.get(store)?.get(key)),
      getAll: vi.fn(async (store: string) => Array.from(stores.get(store)?.values() ?? [])),
      getMap: vi.fn(async (store: string) => new Map(stores.get(store)?.entries() ?? [])),
      keys: vi.fn(async (store: string) => Array.from(stores.get(store)?.keys() ?? [])),
      set: vi.fn(async (store: string, key: string, value: any) => {
        ensure(store).set(key, value);
      }),
      setAll: vi.fn(async (data: Record<string, Record<string, any> | Map<any, any>>) => {
        for (const [store, value] of Object.entries(data)) {
          const target = ensure(store);
          if (value instanceof Map) {
            for (const [k, v] of value.entries()) target.set(String(k), v);
          } else {
            for (const [k, v] of Object.entries(value)) target.set(k, v);
          }
        }
      }),
      hasStore: vi.fn(async (store: string) => stores.has(store)),
      createStore: vi.fn(async (...names: string[]) => {
        for (const name of names) ensure(name);
      }),
      deleteStore: vi.fn(async (store: string | RegExp) => {
        const keys = Array.from(stores.keys());
        for (const key of keys) {
          if ((typeof store === 'string' && key === store) || (store instanceof RegExp && store.test(key))) {
            stores.delete(key);
          }
        }
      }),
      delete: vi.fn(async (store: string, key: string) => {
        stores.get(store)?.delete(key);
      }),
      _stores: stores,
    };
  };

  it('tracks rpc readiness and throws when missing rpc', () => {
    const service = createService({} as any, { anchoring: false } as any, {} as any, {} as any);

    expect(service.isReady('id-1')).toBe(false);
    expect(() => service.rpc('id-1')).toThrow('No RPC for ownable id-1');
  });

  it('creates chain without signing when package is static and anchoring disabled', async () => {
    const eqty = {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 84532,
      sign: vi.fn(),
      anchor: vi.fn(),
      submitAnchors: vi.fn(),
    };
    const service = createService(
      {} as any,
      { anchoring: false, loadAll: vi.fn().mockResolvedValue([]) } as any,
      eqty as any,
      {} as any
    );

    const result = await service.create(basePkg as any);

    expect(result.chain).toBeDefined();
    expect(eqty.sign).not.toHaveBeenCalled();
    expect(eqty.anchor).not.toHaveBeenCalled();
  });

  it('terminates rpc when clearing', () => {
    const service = createService({} as any, { anchoring: false } as any, {} as any, {} as any);
    const rpc = { terminate: vi.fn() } as any;

    (service as any)._rpc.set('id-1', rpc);
    service.clearRpc('id-1');
    expect(rpc.terminate).toHaveBeenCalledTimes(1);
  });

  it('returns undefined from submitAnchors when anchoring is disabled', async () => {
    const service = createService(
      {} as any,
      { anchoring: false } as any,
      { submitAnchors: vi.fn() } as any,
      {} as any
    );

    await expect(service.submitAnchors()).resolves.toBeUndefined();
  });

  it('submits anchors when anchoring is enabled', async () => {
    const eqty = { submitAnchors: vi.fn().mockResolvedValue('0xtx') };
    const service = createService(
      {} as any,
      { anchoring: true } as any,
      eqty as any,
      {} as any
    );

    await expect(service.submitAnchors()).resolves.toBe('0xtx');
    expect(eqty.submitAnchors).toHaveBeenCalledTimes(1);
  });

  it('returns false from canConsume when package is not consumer', async () => {
    const service = createService(
      {} as any,
      {} as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ isConsumer: false }) } as any
    );

    const consumer = { chain: { id: 'c1', state: { hex: '0x1' } }, package: 'pkg-1' } as any;
    const ok = await service.canConsume(consumer, { ownable_type: 'x', issuer: 'y' } as any);
    expect(ok).toBe(false);
  });

  it('returns false from canConsume when state dump is unavailable', async () => {
    const service = createService(
      {} as any,
      { getStateDump: vi.fn().mockResolvedValue(null) } as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ isConsumer: true }) } as any
    );

    const consumer = { chain: { id: 'c1', state: { hex: '0x1' } }, package: 'pkg-1' } as any;
    const ok = await service.canConsume(consumer, { ownable_type: 'x', issuer: 'y' } as any);
    expect(ok).toBe(false);
  });

  it('returns true from canConsume when query confirms consumer relationship', async () => {
    const eventChains = {
      getStateDump: vi.fn().mockResolvedValue([['k', 'v']]),
    };
    const service = createService(
      {} as any,
      eventChains as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ isConsumer: true }) } as any
    );
    (service as any)._rpc.set('c1', {
      query: vi.fn().mockResolvedValue(true),
    });

    const ok = await service.canConsume(
      { chain: { id: 'c1', state: { hex: '0x1' } }, package: 'pkg-1' } as any,
      { ownable_type: 'x', issuer: 'y' } as any
    );
    expect(ok).toBe(true);
  });

  it('returns false from canConsume when rpc query throws', async () => {
    const eventChains = {
      getStateDump: vi.fn().mockResolvedValue([['k', 'v']]),
    };
    const service = createService(
      {} as any,
      eventChains as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ isConsumer: true }) } as any
    );
    (service as any)._rpc.set('c1', {
      query: vi.fn().mockRejectedValue(new Error('query failed')),
    });

    const ok = await service.canConsume(
      { chain: { id: 'c1', state: { hex: '0x1' } }, package: 'pkg-1' } as any,
      { ownable_type: 'x', issuer: 'y' } as any
    );
    expect(ok).toBe(false);
  });

  it('stores chain state via initStore and retries transient write failures', async () => {
    const stateStore = createStateStore();
    let failOnce = true;
    stateStore.setAll.mockImplementationOnce(async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('temporary write failure');
      }
    });
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const service = createService(
      stateStore as any,
      {} as any,
      {} as any,
      {
        info: vi.fn().mockImplementation((_pkg: string, hash?: string) => ({
          keywords: ['k1'],
          uniqueMessageHash: hash ?? 'h1',
        })),
      } as any
    );

    await service.initStore(chain, 'cid-1', 'msg-1', [['k', 'v']] as any);

    expect(stateStore.createStore).toHaveBeenCalled();
    expect(stateStore.setAll).toHaveBeenCalled();
    expect(await stateStore.get(`ownable:${chain.id}`, 'state')).toBe(chain.state.hex);
  });

  it('executes rpc message, signs event, and stores resulting state', async () => {
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const service = createService(
      {} as any,
      {} as any,
      { address: '0xabc', sign: vi.fn() } as any,
      {} as any
    );
    const rpc = {
      execute: vi.fn().mockResolvedValue({ state: [['k', 'v']] }),
    };
    (service as any)._rpc.set(chain.id, rpc);
    const storeSpy = vi.spyOn(service, 'store').mockResolvedValue(undefined as any);

    const msg = { ping: true } as any;
    const result = await service.execute(chain, msg, [] as any);

    expect(result).toEqual([['k', 'v']]);
    expect(rpc.execute).toHaveBeenCalledTimes(1);
    expect(storeSpy).toHaveBeenCalledWith(chain, [['k', 'v']]);
  });

  it('applies event chain and handles instantiate/execute/external contexts', async () => {
    const service = createService(
      {
        hasStore: vi.fn().mockResolvedValue(false),
        keys: vi.fn().mockResolvedValue([]),
      } as any,
      {} as any,
      { address: '0xabc' } as any,
      {} as any
    );
    const rpc = {
      instantiate: vi.fn().mockResolvedValue({ state: [['s1', 1]] }),
      execute: vi.fn().mockResolvedValue({ state: [['s2', 2]] }),
      externalEvent: vi.fn().mockResolvedValue({ state: [['s3', 3]] }),
    };
    const chain = {
      id: 'chain-apply',
      events: [
        { parsedData: { '@context': 'instantiate_msg.json', foo: 1 }, signerAddress: '0x1', hash: { hex: '0x1' } },
        { parsedData: { '@context': 'execute_msg.json', bar: 2 }, signerAddress: '0x2', hash: { hex: '0x2' } },
        {
          parsedData: { '@context': 'external_event_msg.json', type: 'x', attributes: { a: 1 } },
          signerAddress: '0x3',
          hash: { hex: '0x3' },
        },
      ],
    } as any;
    (service as any)._rpc.set(chain.id, rpc);

    const state = await service.apply(chain, [] as any);
    expect(state).toEqual([['s3', 3]]);
    expect(rpc.instantiate).toHaveBeenCalledTimes(1);
    expect(rpc.execute).toHaveBeenCalledTimes(1);
    expect(rpc.externalEvent).toHaveBeenCalledTimes(1);
  });

  it('throws on unknown event context during apply', async () => {
    const service = createService(
      { hasStore: vi.fn().mockResolvedValue(false), keys: vi.fn().mockResolvedValue([]) } as any,
      {} as any,
      { address: '0xabc' } as any,
      {} as any
    );
    const chain = {
      id: 'chain-apply-error',
      events: [{ parsedData: { '@context': 'unknown.json' }, hash: { hex: '0x1' } }],
    } as any;
    (service as any)._rpc.set(chain.id, {
      instantiate: vi.fn(),
      execute: vi.fn(),
      externalEvent: vi.fn(),
    });

    await expect(service.apply(chain, [] as any)).rejects.toThrow('Unknown event type');
  });

  it('consumes ownable and submits shared anchors', async () => {
    const consumer = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const consumable = EventChain.create('0x2222222222222222222222222222222222222222', 84532);
    const eventChains = {
      getStateDump: vi.fn().mockResolvedValue([['state', 1]]),
    };
    const eqty = { address: '0xabc', sign: vi.fn(), submitAnchors: vi.fn().mockResolvedValue('0xtx') };
    const service = createService({} as any, eventChains as any, eqty as any, {} as any);
    const rpcConsumer = {
      externalEvent: vi.fn().mockResolvedValue({ state: [['consumer', 1]] }),
    };
    const rpcConsumable = {
      execute: vi.fn().mockResolvedValue({
        events: [{ type: 'consume', attributes: { any: 'value' } }],
        state: [['consumable', 1]],
      }),
    };
    (service as any)._rpc.set(consumer.id, rpcConsumer);
    (service as any)._rpc.set(consumable.id, rpcConsumable);
    vi.spyOn(service, 'store').mockResolvedValue(undefined as any);
    vi.spyOn(service, 'submitAnchors').mockResolvedValue('0xtx');

    await service.consume(consumer, consumable);

    expect(rpcConsumable.execute).toHaveBeenCalled();
    expect(rpcConsumer.externalEvent).toHaveBeenCalled();
    expect(eqty.sign).toHaveBeenCalledTimes(2);
  });

  it('initializes rpc with package assets and persists initial store', async () => {
    const rpc = {
      initialize: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn(),
      setWidgetWindow: vi.fn(),
    };
    const runtimeRpc = { create: vi.fn().mockReturnValue(rpc) };
    const service = createService(
      {} as any,
      {} as any,
      {} as any,
      {
        getAsset: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      } as any,
      { getWorkerSource: () => '/*worker*/' } as any,
      undefined as any,
      runtimeRpc as any
    );
    const chain = { id: 'chain-init', events: [] } as any;
    const applySpy = vi.spyOn(service, 'apply').mockResolvedValue([['k', 'v']] as any);
    const initStoreSpy = vi.spyOn(service, 'initStore').mockResolvedValue(undefined as any);

    await service.init(chain, 'cid-1', 'msg-1');

    expect(runtimeRpc.create).toHaveBeenCalledWith('chain-init');
    expect(rpc.initialize).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith(chain, []);
    expect(initStoreSpy).toHaveBeenCalledWith(chain, 'cid-1', 'msg-1', [['k', 'v']]);
  });

  it('throws when consume state is mismatched', async () => {
    const service = createService(
      {} as any,
      { getStateDump: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce([]) } as any,
      { address: '0xabc' } as any,
      {} as any
    );
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);

    await expect(service.consume(chain, chain)).rejects.toThrow('State mismatch for consume');
  });

  it('delegates loadAll/delete/deleteAll to event chain service', async () => {
    const eventChains = {
      loadAll: vi.fn().mockResolvedValue([{ id: '1' }]),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      anchoring: false,
    };
    const service = createService({} as any, eventChains as any, {} as any, {} as any);

    await expect(service.loadAll()).resolves.toEqual([{ id: '1' }]);
    await service.delete('id-1');
    await service.deleteAll();

    expect(eventChains.delete).toHaveBeenCalledWith('id-1');
    expect(eventChains.deleteAll).toHaveBeenCalledTimes(1);
  });

  it('retries store writes and throws after repeated verification mismatch', async () => {
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const stateStore = {
      get: vi.fn().mockImplementation(async (_store: string, key: string) => (key === 'state' ? 'different' : undefined)),
      setAll: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(
      stateStore as any,
      { anchoring: false } as any,
      { anchor: vi.fn() } as any,
      {} as any
    );

    await expect(service.store(chain, [['k', 'v']] as any)).rejects.toThrow('Operation failed after 3 attempts');
    expect(stateStore.setAll).toHaveBeenCalled();
  });

  it('queues anchors in store when anchoring is enabled', async () => {
    const stateStore = createStateStore();
    const chain = {
      id: 'chain-anchor',
      state: { hex: '0xnew-state' },
      latestHash: { hex: `0x${'f'.repeat(64)}` },
      events: [{}, {}],
      toJSON: () => ({ id: 'chain-anchor', events: [{}, {}] }),
      startingAfter: vi.fn().mockReturnValue({
        anchorMap: [{ key: Binary.fromHex(`0x${'1'.repeat(64)}`), value: Binary.fromHex(`0x${'0'.repeat(64)}`) }],
      }),
    } as any;
    await stateStore.createStore(`ownable:${chain.id}`);
    await stateStore.set(`ownable:${chain.id}`, 'latestHash', `0x${'e'.repeat(64)}`);
    await stateStore.set(`ownable:${chain.id}`, 'state', 'old-state');

    const eqty = { anchor: vi.fn(), address: '0xabc' };
    const service = createService(
      stateStore as any,
      { anchoring: true } as any,
      eqty as any,
      {} as any
    );

    await service.store(chain, [['k', 'v']] as any);
    expect(chain.startingAfter).toHaveBeenCalled();
    expect(eqty.anchor).toHaveBeenCalled();
  });

  it('skips initStore write when store already exists', async () => {
    const stateStore = createStateStore();
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    await stateStore.createStore(`ownable:${chain.id}`);
    const service = createService(
      stateStore as any,
      {} as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ keywords: [] }) } as any
    );

    await service.initStore(chain, 'cid-1', 'msg-1', [['k', 'v']] as any);
    expect(stateStore.setAll).not.toHaveBeenCalled();
  });

  it('retries initStore when post-write verification has no state entries', async () => {
    const stateStore = createStateStore();
    stateStore.getAll.mockResolvedValue([]);
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const service = createService(
      stateStore as any,
      {} as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ keywords: [] }) } as any
    );

    await expect(service.initStore(chain, 'cid-1', 'msg-1', [['k', 'v']] as any)).resolves.toBeUndefined();
  });

  it('zips ownable chain and rejects empty chains', async () => {
    const zip = { file: vi.fn() };
    const service = createService(
      {} as any,
      {} as any,
      {} as any,
      {
        zip: vi.fn(async () => zip),
      } as any
    );
    const chain = {
      events: [{ parsedData: { package: 'cid-1' } }],
      toJSON: () => ({ id: 'chain-1', events: [{}] }),
    } as any;

    await expect(service.zip({ events: [] } as any)).rejects.toThrow('Cannot zip an empty ownable chain');
    await expect(service.zip(chain)).resolves.toBe(zip);
    expect(zip.file).toHaveBeenCalledWith('chain.json', JSON.stringify(chain.toJSON()));
  });

  it('covers default runtime source and clearRpc noop branch', () => {
    const localLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const service = new OwnableService(
      {} as any,
      { anchoring: false } as any,
      {} as any,
      {} as any,
      undefined as any,
      localLogger as any
    );

    expect((service as any).runtimeSource.getWorkerSource()).toContain('WASM instantiated successfully');
    expect(() => service.clearRpc('missing')).not.toThrow();
  });

  it('creates with anchoring and returns tx hash when anchors are submitted', async () => {
    const fakeChain = {
      id: 'chain-create',
      state: { hex: '0xstate' },
      latestHash: { hex: `0x${'1'.repeat(64)}` },
      add: vi.fn(),
      startingWith: vi.fn().mockReturnValue({ anchorMap: [{ key: 'k', value: 'v' }] }),
    } as any;
    const createSpy = vi.spyOn(EventChain, 'create').mockReturnValue(fakeChain);
    const eqty = {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 84532,
      sign: vi.fn().mockResolvedValue(undefined),
      anchor: vi.fn().mockResolvedValue(undefined),
      submitAnchors: vi.fn().mockResolvedValue('0xtx'),
    };
    const service = createService(
      {} as any,
      { anchoring: true } as any,
      eqty as any,
      {} as any
    );

    const result = await service.create({ ...basePkg, isDynamic: true } as any);
    expect(result.txHash).toBe('0xtx');
    expect(eqty.sign).toHaveBeenCalledTimes(1);
    expect(eqty.anchor).toHaveBeenCalledTimes(1);
    expect(eqty.submitAnchors).toHaveBeenCalledTimes(1);
    createSpy.mockRestore();
  });

  it('initializes with existing rpc and exercises file reader callback path', async () => {
    const runtimeRpc = { create: vi.fn() };
    const service = createService(
      createStateStore() as any,
      {} as any,
      {} as any,
      {
        getAsset: vi.fn().mockImplementation(async (_cid: string, _name: string, read: any) => {
          const reader: any = {
            result: null,
            readAsArrayBuffer: (file: any) => {
              reader.result = new Uint8Array(file).buffer;
            },
          };
          read(reader, Uint8Array.from([1, 2, 3]));
          return reader.result;
        }),
      } as any,
      undefined as any,
      undefined as any,
      runtimeRpc as any
    );
    const chain = { id: 'chain-init-2', events: [] } as any;
    (service as any)._rpc.set(chain.id, {
      terminate: vi.fn(),
      setWidgetWindow: vi.fn(),
    } as any);
    vi.spyOn(service, 'apply').mockResolvedValue([] as any);
    vi.spyOn(service, 'initStore').mockResolvedValue(undefined as any);

    await service.init(chain, 'cid-1');
    expect(runtimeRpc.create).not.toHaveBeenCalled();
  });

  it('manages snapshots: create, read latest, list, and delete', async () => {
    const stateStore = createStateStore();
    const service = createService(stateStore as any, {} as any, {} as any, {} as any);
    const chain = { id: 'snap-chain', latestHash: { hex: '0x01' } } as any;

    await (service as any).createSnapshot(chain, [['a', 1]], 0);
    chain.latestHash.hex = '0x02';
    await (service as any).createSnapshot(chain, [['b', 2]], 1);
    chain.latestHash.hex = '0x03';
    await (service as any).createSnapshot(chain, [['c', 3]], 2);
    chain.latestHash.hex = '0x04';
    await (service as any).createSnapshot(chain, [['d', 4]], 3);

    const latest = await (service as any).getLatestSnapshot(chain.id);
    expect(latest.eventIndex).toBe(3);

    const snapshots = await service.listSnapshots(chain.id);
    expect(snapshots.map((s) => s.eventIndex)).toEqual([1, 2, 3]);

    await service.deleteSnapshots(chain.id);
    await expect(service.listSnapshots(chain.id)).resolves.toEqual([]);
  });

  it('uses snapshot resume path, skips undefined events and yields between batches', async () => {
    const snapshot = {
      eventIndex: 0,
      blockHash: 'h0',
      stateDump: [['snap', 1]],
      timestamp: new Date(),
    };
    const stateStore = {
      hasStore: vi.fn().mockResolvedValue(true),
      keys: vi.fn().mockResolvedValue(['snapshot_0']),
      get: vi.fn().mockResolvedValue(snapshot),
    };
    const service = createService(stateStore as any, {} as any, { address: '0xabc' } as any, {} as any);
    const rpc = {
      execute: vi.fn().mockResolvedValue({ state: [['next', 1]] }),
      instantiate: vi.fn().mockResolvedValue({ state: [['init', 1]] }),
      externalEvent: vi.fn().mockResolvedValue({ state: [['ext', 1]] }),
    };
    const events = Array.from({ length: 12 }, (_, i) =>
      i === 5
        ? undefined
        : ({
            parsedData: { '@context': 'execute_msg.json', n: i },
            hash: { hex: i === 0 ? 'h0' : `h${i}` },
            signerAddress: '0x1',
          } as any)
    );
    const chain = { id: 'chain-batch', events } as any;
    (service as any)._rpc.set(chain.id, rpc);
    const timeoutSpy = vi.spyOn(global, 'setTimeout');

    const result = await service.apply(chain, [] as any);
    expect(result).toEqual([['next', 1]]);
    expect(timeoutSpy).toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });

  it('creates recovery snapshot when apply fails after first event', async () => {
    const stateStore = {
      hasStore: vi.fn().mockResolvedValue(false),
      keys: vi.fn().mockResolvedValue([]),
    };
    const service = createService(stateStore as any, {} as any, { address: '0xabc' } as any, {} as any);
    const createSnapshotSpy = vi
      .spyOn(service as any, 'createSnapshot')
      .mockResolvedValue(undefined);
    const rpc = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ state: [['ok', 1]] })
        .mockRejectedValueOnce(new Error('boom')),
      instantiate: vi.fn(),
      externalEvent: vi.fn(),
    };
    const chain = {
      id: 'chain-fail',
      events: [
        { parsedData: { '@context': 'execute_msg.json', a: 1 }, hash: { hex: 'h1' } },
        { parsedData: { '@context': 'execute_msg.json', a: 2 }, hash: { hex: 'h2' } },
      ],
    } as any;
    (service as any)._rpc.set(chain.id, rpc);

    await expect(service.apply(chain, [] as any)).rejects.toThrow('boom');
    expect(createSnapshotSpy).toHaveBeenCalledWith(chain, [['ok', 1]], 0);
  });

  it('throws when consume event is missing and store short-circuits when state unchanged', async () => {
    const stateRef = { hex: '0xstate' };
    const service = createService(
      {
        get: vi.fn().mockResolvedValue(stateRef),
        setAll: vi.fn(),
      } as any,
      {
        getStateDump: vi.fn().mockResolvedValue([['s', 1]]),
      } as any,
      { address: '0xabc', sign: vi.fn(), anchor: vi.fn() } as any,
      {} as any
    );
    const consumer = { id: 'consumer-1', state: { hex: '0x1' } } as any;
    const consumable = { id: 'consumable-1', state: { hex: '0x2' } } as any;
    (service as any)._rpc.set(consumable.id, {
      execute: vi.fn().mockResolvedValue({ events: [], state: [['x', 1]] }),
    });
    (service as any)._rpc.set(consumer.id, {
      externalEvent: vi.fn(),
    });

    await expect(service.consume(consumer, consumable)).rejects.toThrow(
      'No consume event emitted'
    );

    await service.store(
      { id: 'same-state', state: stateRef, events: [] } as any,
      [] as any
    );
    expect((service as any).stateStore.setAll).not.toHaveBeenCalled();
  });
});
