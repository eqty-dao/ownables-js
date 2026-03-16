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
});
