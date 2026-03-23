import { describe, expect, it } from 'vitest';

import BucketStateStore from '../src/services/BucketStateStore.service';

class InMemoryBucket {
  private readonly map = new Map<string, Uint8Array>();

  async list(): Promise<string[]> {
    return Array.from(this.map.keys());
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.map.get(key);
  }

  async put(key: string, value: Uint8Array | Buffer | string): Promise<void> {
    const bytes =
      typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    this.map.set(key, Uint8Array.from(bytes));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

describe('BucketStateStore', () => {
  it('supports basic store lifecycle and CRUD operations', async () => {
    const store = new BucketStateStore(new InMemoryBucket() as any);

    await store.createStore('ownable:1');
    expect(await store.hasStore('ownable:1')).toBe(true);

    await store.set('ownable:1', 'state', 'abc');
    expect(await store.get('ownable:1', 'state')).toBe('abc');

    await store.delete('ownable:1', 'state');
    expect(await store.get('ownable:1', 'state')).toBeUndefined();
  });

  it('supports setAll overloads and map roundtrip', async () => {
    const store = new BucketStateStore(new InMemoryBucket() as any);

    await store.setAll('one', { a: 1, b: 2 });
    expect(await store.get('one', 'a')).toBe(1);

    await store.setAll({
      two: new Map<any, any>([[Uint8Array.from([1, 2]), { n: 42 }]]),
      three: { k: 'v' },
    });

    const map = await store.getMap('two');
    expect(map.size).toBe(1);
    const [key, value] = Array.from(map.entries())[0] ?? [];
    expect(key instanceof Uint8Array).toBe(true);
    expect(value).toEqual({ n: 42 });

    expect(await store.get('three', 'k')).toBe('v');
  });

  it('lists and deletes stores by regex', async () => {
    const store = new BucketStateStore(new InMemoryBucket() as any);

    await store.set('ownable:1', 'state', 'a');
    await store.set('ownable:2', 'state', 'b');
    await store.set('other:1', 'state', 'c');

    const stores = await store.listStores();
    expect(stores).toEqual(expect.arrayContaining(['ownable:1', 'ownable:2', 'other:1']));

    await store.deleteStore(/^ownable:.+/);

    expect(await store.hasStore('ownable:1')).toBe(false);
    expect(await store.hasStore('ownable:2')).toBe(false);
    expect(await store.hasStore('other:1')).toBe(true);
  });

  it('supports non-string key serialization paths', async () => {
    const store = new BucketStateStore(new InMemoryBucket() as any);

    await store.setAll('bin', new Map<any, any>([
      [Uint8Array.from([1, 2]), { kind: 'u8' }],
      [new Uint16Array([3, 4]), { kind: 'u16' }],
      [new ArrayBuffer(2), { kind: 'ab' }],
      [[5, 6], { kind: 'arr' }],
      [{ x: 1 }, { kind: 'obj' }],
    ]));

    const map = await store.getMap('bin');
    expect(map.size).toBe(5);
  });

  it('returns only string keys from keys()', async () => {
    const store = new BucketStateStore(new InMemoryBucket() as any);
    await store.set('strings', 'a', 1);
    await store.setAll('strings', new Map<any, any>([[Uint8Array.from([1]), 2]]));

    const keys = await store.keys('strings');
    expect(keys).toContain('a');
    expect(keys.some((k) => typeof k !== 'string')).toBe(false);
  });
});
