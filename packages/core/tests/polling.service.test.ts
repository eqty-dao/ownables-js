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
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (...args: any[]) =>
    new PollingService(args[0], args[1], logger as any);

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

    const service = createService(relay as any, localStorage as any);
    const count = await service.checkForNewHashes('0xabc');

    expect(count).toBe(2);
    expect(localStorage.get('messageCount')).toBe(2);
  });

  it('returns cached count on 304 responses', async () => {
    const localStorage = createKVStore({
      packages: [{ uniqueMessageHash: 'a' }],
      messageCount: 7,
      lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
    });
    const relay = {
      url: 'https://relay.test',
      isAvailable: vi.fn().mockResolvedValue(true),
      ensureAuthenticated: vi.fn().mockResolvedValue(true),
      getAuthHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer x' }),
      relay: {
        get: vi.fn().mockResolvedValue({ status: 304 }),
      },
    };

    const service = createService(relay as any, localStorage as any);
    await expect(service.checkForNewHashes('0xabc')).resolves.toBe(7);
    expect(relay.relay.get).toHaveBeenCalledWith('messages/0xabc', expect.objectContaining({
      'If-Modified-Since': 'Mon, 01 Jan 2026 00:00:00 GMT',
    }));
  });

  it('returns 0 when relay is unavailable', async () => {
    const localStorage = createKVStore({ packages: [] });
    const relay = {
      url: 'https://relay.test',
      isAvailable: vi.fn().mockResolvedValue(false),
      ensureAuthenticated: vi.fn(),
      getAuthHeaders: vi.fn(),
      relay: { get: vi.fn() },
    };

    const service = createService(relay as any, localStorage as any);
    await expect(service.checkForNewHashes('0xabc')).resolves.toBe(0);
    expect(relay.ensureAuthenticated).not.toHaveBeenCalled();
  });

  it('handles polling lifecycle and cache clearing', async () => {
    const localStorage = createKVStore({ packages: [] });
    const relay = {
      url: 'https://relay.test',
      isAvailable: vi.fn().mockResolvedValue(true),
      ensureAuthenticated: vi.fn().mockResolvedValue(true),
      getAuthHeaders: vi.fn().mockReturnValue({}),
      relay: { get: vi.fn().mockResolvedValue({ status: 200, data: { messages: [] }, headers: {} }) },
    };
    const service = createService(relay as any, localStorage as any);
    const onUpdate = vi.fn();

    const stop = service.startPolling('0xabc', onUpdate, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    service.stopPolling();
    service.clearCache();

    expect(onUpdate).toHaveBeenCalled();
    expect(localStorage.get('lastModified')).toBeUndefined();
  });

  it('stops polling after repeated relay failures', async () => {
    const localStorage = createKVStore({ packages: [] });
    const relay = {
      url: 'https://relay.test',
      isAvailable: vi.fn().mockResolvedValue(true),
      ensureAuthenticated: vi.fn().mockResolvedValue(true),
      getAuthHeaders: vi.fn().mockReturnValue({}),
      relay: { get: vi.fn().mockRejectedValue(new Error('boom')) },
    };
    const service = createService(relay as any, localStorage as any);

    for (let i = 0; i < 6; i += 1) {
      await service.checkForNewHashes('0xabc');
    }

    await expect(service.checkForNewHashes('0xabc')).resolves.toBe(0);
  });
});
