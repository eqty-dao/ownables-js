import { describe, expect, it } from 'vitest';

import IDBService from '../src/services/IDB.service';

type FakeRequest = {
  result?: any;
  error?: Error;
  onsuccess?: (event: Event) => void;
  onerror?: (event: Event) => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
};

type FakeTx = {
  objectStore: (name: string) => any;
  oncomplete?: () => void;
  onerror?: (event: Event) => void;
  onabort?: () => void;
  abort: () => void;
};

class NameList {
  constructor(public items: string[]) {}
  contains(name: string): boolean {
    return this.items.includes(name);
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

function createFakeIndexedDb() {
  const stores = new Map<string, Map<string, any>>();
  const deletedDbs: string[] = [];

  const db = {
    version: 1,
    objectStoreNames: new NameList([]),
    close: () => undefined,
    createObjectStore(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      if (!db.objectStoreNames.contains(name)) db.objectStoreNames.items.push(name);
    },
    deleteObjectStore(name: string) {
      stores.delete(name);
      db.objectStoreNames.items = db.objectStoreNames.items.filter((n) => n !== name);
    },
    transaction(storeNames: string | string[], _mode: string): FakeTx {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of names) {
        if (!stores.has(name)) stores.set(name, new Map());
        if (!db.objectStoreNames.contains(name)) db.objectStoreNames.items.push(name);
      }

      const tx: FakeTx = {
        objectStore(name: string) {
          const target = stores.get(name) ?? new Map<string, any>();
          stores.set(name, target);

          const mkReq = <T,>(fn: () => T): FakeRequest => {
            const req: FakeRequest = {};
            queueMicrotask(() => {
              try {
                req.result = fn();
                req.onsuccess?.({ target: req } as unknown as Event);
              } catch (error) {
                req.error = error as Error;
                req.onerror?.({ target: req } as unknown as Event);
              }
            });
            return req;
          };

          return {
            get(key: string) {
              return mkReq(() => target.get(key));
            },
            getAll() {
              return mkReq(() => Array.from(target.values()));
            },
            openCursor() {
              const req: FakeRequest = {};
              const entries = Array.from(target.entries());
              let idx = 0;
              const emit = () => {
                if (idx >= entries.length) {
                  req.result = null;
                  req.onsuccess?.({ target: req } as unknown as Event);
                  return;
                }
                const [key, value] = entries[idx]!;
                req.result = {
                  primaryKey: key,
                  value,
                  continue: () => {
                    idx += 1;
                    queueMicrotask(emit);
                  },
                };
                req.onsuccess?.({ target: req } as unknown as Event);
              };
              queueMicrotask(emit);
              return req;
            },
            getAllKeys() {
              return mkReq(() => Array.from(target.keys()));
            },
            put(value: any, key: string) {
              return mkReq(() => target.set(key, value));
            },
            clear() {
              return mkReq(() => target.clear());
            },
            delete(key: string) {
              return mkReq(() => target.delete(key));
            },
          };
        },
        abort() {
          tx.onabort?.();
        },
      };

      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  } as unknown as IDBDatabase;

  const api = {
    open: (name: string, version?: number) => {
      const req: FakeRequest = {};
      queueMicrotask(() => {
        if (version && version > (db as any).version) {
          (db as any).version = version;
          req.result = db;
          req.onupgradeneeded?.();
        }
        req.result = db;
        req.onsuccess?.({ target: req } as unknown as Event);
      });
      return req as unknown as IDBOpenDBRequest;
    },
    deleteDatabase: (name: string) => {
      const req: FakeRequest = {};
      queueMicrotask(() => {
        deletedDbs.push(name);
        req.onsuccess?.({ target: req } as unknown as Event);
      });
      return req as unknown as IDBOpenDBRequest;
    },
    databases: async () => [
      { name: 'ownables' },
      { name: 'ownables:user-1' },
      { name: 'other-db' },
    ],
  } as unknown as IDBFactory;

  return { api, db, stores, deletedDbs };
}

describe('IDBService', () => {
  it('opens database using injected indexedDB API', async () => {
    const { api } = createFakeIndexedDb();
    const service = await IDBService.open('test', api);
    expect(service).toBeInstanceOf(IDBService);
  });

  it('caches main instance', async () => {
    const { api } = createFakeIndexedDb();
    const a = await IDBService.main(api);
    const b = await IDBService.main(api);
    expect(a).toBe(b);
  });

  it('supports CRUD and map/list helpers', async () => {
    const { api } = createFakeIndexedDb();
    const service = await IDBService.open('crud', api);

    await service.createStore('items');
    await service.set('items', 'a', { ok: true });
    await service.set('items', 'b', { ok: false });

    await expect(service.get('items', 'a')).resolves.toEqual({ ok: true });
    await expect(service.getAll('items')).resolves.toHaveLength(2);
    await expect(service.keys('items')).resolves.toEqual(['a', 'b']);
    await expect(service.getMap('items')).resolves.toEqual(
      new Map([
        ['a', { ok: true }],
        ['b', { ok: false }],
      ])
    );

    await service.delete('items', 'b');
    await expect(service.keys('items')).resolves.toEqual(['a']);

    await service.clear('items');
    await expect(service.getAll('items')).resolves.toEqual([]);
  });

  it('supports setAll overloads', async () => {
    const { api } = createFakeIndexedDb();
    const service = await IDBService.open('setall', api);

    await service.createStore('s1', 's2');
    await service.setAll('s1', { k1: 'v1', k2: 'v2' });
    await service.setAll({ s2: new Map([['x', 1]]) });

    await expect(service.get('s1', 'k1')).resolves.toBe('v1');
    await expect(service.get('s2', 'x')).resolves.toBe(1);
  });

  it('lists/has/deletes stores by name and regex', async () => {
    const { api } = createFakeIndexedDb();
    const service = await IDBService.open('stores', api);

    await service.createStore('one', 'two', 'tmp:1');
    await expect(service.hasStore('one')).resolves.toBe(true);
    await expect(service.listStores()).resolves.toEqual(expect.arrayContaining(['one', 'two', 'tmp:1']));

    await service.deleteStore('one');
    await expect(service.hasStore('one')).resolves.toBe(false);

    await service.deleteStore(/^tmp:/);
    await expect(service.hasStore('tmp:1')).resolves.toBe(false);
  });

  it('deletes active DB and ownables-prefixed DBs', async () => {
    const { api, deletedDbs } = createFakeIndexedDb();
    const service = await IDBService.open('cleanup', api);

    await service.deleteDatabase();
    await service.deleteAllDatabases();

    expect(deletedDbs).toContain('ownables:cleanup');
    expect(deletedDbs).toContain('ownables');
    expect(deletedDbs).toContain('ownables:user-1');
    expect(deletedDbs).not.toContain('other-db');
  });
});
