import { describe, expect, it, vi } from 'vitest';

import { PollingService } from '../src/services/Polling.service';

function createKVStore(initial: Record<string, unknown> = {}) {
  const state = new Map(Object.entries(initial));
  return {
    get: (k: string) => state.get(k),
    set: (k: string, v: unknown) => state.set(k, v),
    remove: (k: string) => state.delete(k),
    clear: () => state.clear(),
  };
}

describe('PollingService', () => {
  it('stores messageCount and returns new hashes count', async () => {
    const localStorage = createKVStore({ packages: [{ uniqueMessageHash: 'a' }] });

    const relay = {
      url: 'https://relay.test',
      isAvailable: vi.fn().mockResolvedValue(true),
      ensureAuthenticated: vi.fn().mockResolvedValue(true),
      getAuthHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer x' }),
      relay: {
        get: vi.fn().mockResolvedValue({
          status: 200,
          data: { messages: [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }] },
          headers: { 'last-modified': 'Mon, 01 Jan 2026 00:00:00 GMT' },
        }),
      },
    };

    const service = new PollingService(relay as any, localStorage as any);
    const count = await service.checkForNewHashes('0xabc');

    expect(count).toBe(2);
    expect(localStorage.get('messageCount')).toBe(2);
  });
});
