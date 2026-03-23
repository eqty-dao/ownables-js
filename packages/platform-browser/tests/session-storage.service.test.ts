import { describe, expect, it } from 'vitest';

import SessionStorageService from '../src/services/SessionStorage.service';

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

describe('SessionStorageService', () => {
  it('reads/writes via injected storage', () => {
    const storage = createStorageMock();

    SessionStorageService.set('a', { count: 1 }, storage);
    expect(SessionStorageService.get('a', storage)).toEqual({ count: 1 });

    SessionStorageService.remove('a', storage);
    expect(SessionStorageService.get('a', storage)).toBeUndefined();
  });

  it('clears injected storage', () => {
    const storage = createStorageMock();
    SessionStorageService.set('a', 1, storage);
    SessionStorageService.set('b', 2, storage);

    SessionStorageService.clear(storage);
    expect(storage.length).toBe(0);
  });

  it('throws on invalid JSON payloads from storage', () => {
    const storage = createStorageMock();
    storage.setItem('bad', '{invalid');

    expect(() => SessionStorageService.get('bad', storage)).toThrow();
  });
});
