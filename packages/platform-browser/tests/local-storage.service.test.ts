import { describe, expect, it } from 'vitest';

import LocalStorageService from '../src/services/LocalStorage.service';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('LocalStorageService', () => {
  it('uses injected storage instance', () => {
    const storage = createStorageMock();
    const service = new LocalStorageService('group', storage);

    service.set('key', { ok: true });
    expect(service.get('key')).toEqual({ ok: true });

    service.remove('key');
    expect(service.get('key')).toBeUndefined();
  });

  it('appends values and clears grouped keys', () => {
    const storage = createStorageMock();
    const service = new LocalStorageService('group', storage);

    storage.setItem('group:group:items', JSON.stringify([1]));
    service.append('items', 2);
    expect(JSON.parse(storage.getItem('group:group:items') as string)).toEqual([1, 2]);

    storage.setItem('other:key', JSON.stringify([9]));
    service.clear();
    expect(storage.getItem('group:items')).toBeNull();
    expect(storage.getItem('other:key')).not.toBeNull();
  });

  it('removes by value and field from array entries', () => {
    const storage = createStorageMock();
    const service = new LocalStorageService('group', storage);

    storage.setItem('group:group:strings', JSON.stringify(['a', 'b', 'c']));
    service.removeItem('strings', 'b');
    expect(JSON.parse(storage.getItem('group:group:strings') as string)).toEqual(['a', 'c']);

    storage.setItem('group:group:objects', JSON.stringify([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]));
    service.removeByField('objects', 'id', 1);
    expect(JSON.parse(storage.getItem('group:group:objects') as string)).toEqual([{ id: 2, name: 'b' }]);
  });

  it('throws when list operations target non-array values', () => {
    const storage = createStorageMock();
    const service = new LocalStorageService('group', storage);

    storage.setItem('group:group:not-array', JSON.stringify({ ok: true }));
    expect(() => service.append('not-array', 1)).toThrow('is not an array');
    expect(() => service.removeItem('not-array', 'x')).toThrow('is not an array');
    expect(() => service.removeByField('not-array', 'id', 1)).toThrow('is not an array');
  });

  it('clears all keys via static helper', () => {
    const storage = createStorageMock();
    storage.setItem('a', '1');
    storage.setItem('b', '2');
    LocalStorageService.clearAll(storage);
    expect(storage.length).toBe(0);
  });
});
