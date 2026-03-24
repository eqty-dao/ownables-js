import { describe, expect, it, vi } from 'vitest';
import { Binary, EventChain } from 'eqty-core';

import EventChainService from '../src/services/EventChain.service';

describe('EventChainService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (...args: any[]) =>
    new EventChainService(args[0], args[1], args[2], logger as any);

  const createStateStore = () => {
    const stores = new Map<string, Map<string, any>>();
    const ensure = (store: string) => {
      if (!stores.has(store)) stores.set(store, new Map());
      return stores.get(store)!;
    };
    return {
      listStores: vi.fn(async () => Array.from(stores.keys())),
      get: vi.fn(async (store: string, key: string) => stores.get(store)?.get(key)),
      getMap: vi.fn(async (store: string) => new Map(stores.get(store)?.entries() ?? [])),
      hasStore: vi.fn(async (store: string) => stores.has(store)),
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
      deleteStore: vi.fn(async (matcher: string | RegExp) => {
        const keys = Array.from(stores.keys());
        for (const key of keys) {
          if (
            (typeof matcher === 'string' && key === matcher) ||
            (matcher instanceof RegExp && matcher.test(key))
          ) {
            stores.delete(key);
          }
        }
      }),
      _stores: stores,
    };
  };

  it('reads and updates anchoring via injected settings store', () => {
    const settings = {
      get: vi.fn().mockReturnValue(false),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };

    const service = createService({} as any, {} as any, settings as any);
    expect(service.anchoring).toBe(false);

    service.setAnchoring(true);
    expect(settings.set).toHaveBeenCalledWith('anchoring', true);
  });

  it('delegates verify to anchor provider', async () => {
    const eqty = {
      verifyAnchors: vi.fn().mockResolvedValue({ verified: true, anchors: {}, map: {} }),
    };

    const service = createService({} as any, eqty as any);
    const result = await service.verify({ anchorMap: [{ key: { hex: '0x1' }, value: { hex: '0x2' } }] } as any);

    expect(result.verified).toBe(true);
    expect(eqty.verifyAnchors).toHaveBeenCalledTimes(1);
  });

  it('stores chain state and queues anchors when anchoring is enabled', async () => {
    const idb = createStateStore();
    const eqty = { anchor: vi.fn(), verifyAnchors: vi.fn() };
    const service = createService(idb as any, eqty as any, {
      get: vi.fn().mockReturnValue(true),
      set: vi.fn(),
    } as any);

    const chain = {
      id: 'chain-1',
      state: { hex: `0x${'1'.repeat(64)}` },
      latestHash: { hex: `0x${'2'.repeat(64)}` },
      toJSON: () => ({ id: 'chain-1' }),
      anchorMap: [{ key: { hex: '0xabc' }, value: { hex: '0xdef' } }],
      startingAfter: () => ({ anchorMap: [{ key: { hex: '0xabc' }, value: { hex: '0xdef' } }] }),
    } as any;
    const stateDump = [['k1', 'v1']] as any;

    await service.store({ chain, stateDump });

    expect(eqty.anchor).toHaveBeenCalledTimes(1);
    expect(idb.setAll).toHaveBeenCalledTimes(1);
    expect(await idb.get(`ownable:${chain.id}`, 'state')).toBe(chain.state.hex);
  });

  it('skips store write when state did not change', async () => {
    const idb = createStateStore();
    const eqty = { anchor: vi.fn(), verifyAnchors: vi.fn() };
    const service = createService(idb as any, eqty as any, {
      get: vi.fn().mockReturnValue(false),
      set: vi.fn(),
    } as any);

    const chain = {
      id: 'chain-skip',
      state: 'same-state',
      toJSON: () => ({ id: 'chain-skip' }),
      latestHash: { hex: `0x${'3'.repeat(64)}` },
      anchorMap: [],
      startingAfter: () => ({ anchorMap: [] }),
    } as any;
    await idb.setAll({ [`ownable:${chain.id}`]: { state: 'same-state' } });
    idb.setAll.mockClear();

    await service.store({ chain, stateDump: [] as any });

    expect(idb.setAll).not.toHaveBeenCalled();
    expect(eqty.anchor).not.toHaveBeenCalled();
  });

  it('loads all stored chains and filters invalid entries', async () => {
    const idb = createStateStore();
    const chainA = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const chainB = EventChain.create('0x2222222222222222222222222222222222222222', 84532);

    await idb.setAll({
      [`ownable:${chainA.id}`]: {
        chain: chainA.toJSON(),
        package: 'cid-a',
        created: new Date('2026-01-01T00:00:00.000Z'),
        keywords: ['a'],
        latestHash: chainA.latestHash.hex,
        uniqueMessageHash: 'm-a',
      },
      [`ownable:${chainB.id}`]: {
        chain: chainB.toJSON(),
        package: 'cid-b',
        created: new Date('2026-01-02T00:00:00.000Z'),
        keywords: ['b'],
        latestHash: chainB.latestHash.hex,
        uniqueMessageHash: 'm-b',
      },
      'junk:store': { foo: 'bar' },
    });

    const service = createService(idb as any, { verifyAnchors: vi.fn() } as any);
    const list = await service.loadAll();

    expect(list).toHaveLength(2);
    expect(list[0]?.package).toBe('cid-a');
    expect(list[1]?.package).toBe('cid-b');
  });

  it('returns state dump only for matching state hash', async () => {
    const idb = createStateStore();
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    await idb.setAll({
      [`ownable:${chain.id}`]: { state: chain.state.hex },
      [`ownable:${chain.id}.state`]: new Map([
        ['s1', 'v1'],
        ['s2', 'v2'],
      ]),
    });

    const service = createService(idb as any, { verifyAnchors: vi.fn() } as any);
    const noMatch = await service.getStateDump(chain.id, Binary.fromHex(`0x${'f'.repeat(64)}`));
    const match = await service.getStateDump(chain.id, chain.state.hex);

    expect(noMatch).toBeNull();
    expect(match).toEqual([
      ['s1', 'v1'],
      ['s2', 'v2'],
    ]);
  });

  it('deletes single chain and all chains', async () => {
    const idb = createStateStore();
    const service = createService(idb as any, { verifyAnchors: vi.fn() } as any);

    await service.delete('abc123');
    await service.deleteAll();

    expect(idb.deleteStore).toHaveBeenNthCalledWith(1, /^ownable:abc123(\..+)?$/);
    expect(idb.deleteStore).toHaveBeenNthCalledWith(2, /^ownable:.+/);
  });

  it('continues loadAll when a chain fails to load and logs the error', async () => {
    const idb = createStateStore();
    await idb.setAll({
      'ownable:ok': { chain: {}, package: 'cid-ok', created: new Date(), keywords: [] },
      'ownable:bad': { chain: {}, package: 'cid-bad', created: new Date(), keywords: [] },
    });
    const service = createService(idb as any, { verifyAnchors: vi.fn() } as any);
    vi.spyOn(service, 'load')
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce({
        chain: EventChain.create('0x1111111111111111111111111111111111111111', 84532),
        package: 'cid-ok',
        created: new Date('2026-01-01T00:00:00.000Z'),
        keywords: [],
        uniqueMessageHash: 'm1',
      } as any);

    const result = await service.loadAll();
    expect(result).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load chain with id'),
      expect.any(Error)
    );
  });
});
