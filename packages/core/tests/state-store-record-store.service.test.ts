import { describe, expect, it } from 'vitest';

import type { StateStore } from '../src/interfaces/core';
import StateStoreRecordStore from '../src/services/StateStoreRecordStore.service';

class InMemoryStateStore implements StateStore {
  private readonly stores = new Map<string, Map<string, unknown>>();

  async get(store: string, key: string): Promise<unknown> {
    return this.stores.get(store)?.get(key);
  }

  async getAll(store: string): Promise<unknown[]> {
    return Array.from(this.stores.get(store)?.values() ?? []);
  }

  async getMap(store: string): Promise<Map<unknown, unknown>> {
    return new Map(this.stores.get(store)?.entries() ?? []);
  }

  async keys(store: string): Promise<string[]> {
    return Array.from(this.stores.get(store)?.keys() ?? []);
  }

  async set(store: string, key: string, value: unknown): Promise<void> {
    if (!this.stores.has(store)) this.stores.set(store, new Map());
    this.stores.get(store)?.set(key, value);
  }

  async setAll(store: string, map: Record<string, unknown> | Map<unknown, unknown>): Promise<void>;
  async setAll(data: Record<string, Record<string, unknown> | Map<unknown, unknown>>): Promise<void>;
  async setAll(
    a: string | Record<string, Record<string, unknown> | Map<unknown, unknown>>,
    b?: Record<string, unknown> | Map<unknown, unknown>
  ): Promise<void> {
    const data: Record<string, Record<string, unknown> | Map<unknown, unknown>> =
      typeof a === 'string' && b ? { [a]: b } : (a as Record<string, Record<string, unknown> | Map<unknown, unknown>>);

    for (const [store, values] of Object.entries(data)) {
      if (!this.stores.has(store)) this.stores.set(store, new Map());
      const target = this.stores.get(store)!;
      const entries = values instanceof Map ? values.entries() : Object.entries(values);
      for (const [key, value] of entries) {
        target.set(String(key), value);
      }
    }
  }

  async hasStore(store: string): Promise<boolean> {
    return this.stores.has(store);
  }

  async createStore(...stores: string[]): Promise<void> {
    for (const store of stores) {
      if (!this.stores.has(store)) this.stores.set(store, new Map());
    }
  }

  async deleteStore(store: string | RegExp): Promise<void> {
    if (typeof store === 'string') {
      this.stores.delete(store);
      return;
    }

    for (const key of this.stores.keys()) {
      if (store.test(key)) this.stores.delete(key);
    }
  }

  async listStores(): Promise<string[]> {
    return Array.from(this.stores.keys());
  }

  async delete(store: string, key: string): Promise<void> {
    this.stores.get(store)?.delete(key);
  }
}

describe('StateStoreRecordStore', () => {
  it('stores and queries records by cid, nft and owner indexes', async () => {
    const store = new StateStoreRecordStore(new InMemoryStateStore());

    await store.put({
      cid: 'cid-1',
      prevOwner: '0xAbC',
      nft: { network: 'eip155:base', address: '0xDEF', id: '1' },
      createdAt: new Date().toISOString(),
    });

    await expect(store.hasCid('cid-1')).resolves.toBe(true);
    await expect(
      store.getCidByNft({ network: 'eip155:base', address: '0xdef', id: '1' })
    ).resolves.toBe('cid-1');

    const owners = await store.listByPrevOwner('0xaBc');
    expect(owners).toHaveLength(1);
    expect(owners[0]?.cid).toBe('cid-1');
  });

  it('updates indexes when existing cid is overwritten', async () => {
    const store = new StateStoreRecordStore(new InMemoryStateStore());

    await store.put({
      cid: 'cid-1',
      prevOwner: '0x111',
      nft: { network: 'eip155:base', address: '0xAAA', id: '1' },
      createdAt: new Date().toISOString(),
    });

    await store.put({
      cid: 'cid-1',
      prevOwner: '0x222',
      nft: { network: 'eip155:base', address: '0xBBB', id: '2' },
      createdAt: new Date().toISOString(),
    });

    await expect(
      store.getCidByNft({ network: 'eip155:base', address: '0xaaa', id: '1' })
    ).resolves.toBeUndefined();

    await expect(
      store.getCidByNft({ network: 'eip155:base', address: '0xbbb', id: '2' })
    ).resolves.toBe('cid-1');

    await expect(store.listByPrevOwner('0x111')).resolves.toEqual([]);
    await expect(store.listByPrevOwner('0x222')).resolves.toHaveLength(1);
  });

  it('returns undefined from getByNft when nft index has no cid', async () => {
    const store = new StateStoreRecordStore(new InMemoryStateStore());

    await expect(
      store.getByNft({ network: 'eip155:base', address: '0xaaa', id: '404' })
    ).resolves.toBeUndefined();
  });
});
