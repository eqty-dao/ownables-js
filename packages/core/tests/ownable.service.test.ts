import { describe, expect, it, vi } from 'vitest';
import { EventChain } from 'eqty-core';

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
    const service = new OwnableService({} as any, { anchoring: false } as any, {} as any, {} as any);

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
    const service = new OwnableService(
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

  it('handles Cancelled-like errors when clearing rpc', () => {
    const service = new OwnableService({} as any, { anchoring: false } as any, {} as any, {} as any);

    const rpc = {} as Record<string, unknown>;
    Object.defineProperty(rpc, 'handler', {
      configurable: true,
      get() {
        return true;
      },
      set() {
        const err = new Error('cancelled');
        err.name = 'Cancelled';
        throw err;
      },
    });

    (service as any)._rpc.set('id-1', rpc);
    expect(() => service.clearRpc('id-1')).not.toThrow();
  });

  it('returns undefined from submitAnchors when anchoring is disabled', async () => {
    const service = new OwnableService(
      {} as any,
      { anchoring: false } as any,
      { submitAnchors: vi.fn() } as any,
      {} as any
    );

    await expect(service.submitAnchors()).resolves.toBeUndefined();
  });

  it('submits anchors when anchoring is enabled', async () => {
    const eqty = { submitAnchors: vi.fn().mockResolvedValue('0xtx') };
    const service = new OwnableService(
      {} as any,
      { anchoring: true } as any,
      eqty as any,
      {} as any
    );

    await expect(service.submitAnchors()).resolves.toBe('0xtx');
    expect(eqty.submitAnchors).toHaveBeenCalledTimes(1);
  });

  it('returns false from canConsume when package is not consumer', async () => {
    const service = new OwnableService(
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
    const service = new OwnableService(
      {} as any,
      { getStateDump: vi.fn().mockResolvedValue(null) } as any,
      {} as any,
      { info: vi.fn().mockReturnValue({ isConsumer: true }) } as any
    );

    const consumer = { chain: { id: 'c1', state: { hex: '0x1' } }, package: 'pkg-1' } as any;
    const ok = await service.canConsume(consumer, { ownable_type: 'x', issuer: 'y' } as any);
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
    const service = new OwnableService(
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

  it('throws when consume state is mismatched', async () => {
    const service = new OwnableService(
      {} as any,
      { getStateDump: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce([]) } as any,
      { address: '0xabc' } as any,
      {} as any
    );
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);

    await expect(service.consume(chain, chain)).rejects.toThrow('State mismatch for consume');
  });

  it('zips ownable chain and rejects empty chains', async () => {
    const zip = { file: vi.fn() };
    const service = new OwnableService(
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
});
