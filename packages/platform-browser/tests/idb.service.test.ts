import { describe, expect, it } from 'vitest';

import IDBService from '../src/services/IDB.service';

describe('IDBService', () => {
  it('opens database using injected indexedDB API', async () => {
    const fakeDb = { close: () => undefined } as unknown as IDBDatabase;
    const indexedDBApi = {
      open: (name: string) => {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => {
          (request as any).result = fakeDb;
          request.onsuccess?.({ target: request } as Event);
        });
        expect(name).toContain('ownables:test');
        return request;
      },
    } as IDBFactory;

    const service = await IDBService.open('test', indexedDBApi);
    expect(service).toBeInstanceOf(IDBService);
  });
});
