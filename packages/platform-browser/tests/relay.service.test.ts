import { describe, expect, it, vi } from 'vitest';

import { RelayService } from '../src/services/Relay.service';

describe('RelayService', () => {
  it('authenticates with injected siwe client and storage', async () => {
    const storage = new Map<string, string>();
    const storageApi = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };

    const relayClient = {
      get: vi.fn().mockResolvedValue({ messages: [] }),
      send: vi.fn(),
      delete: vi.fn(),
    };

    const siweClient = {
      authenticate: vi.fn().mockResolvedValue({
        success: true,
        token: 'token-1',
        expiresIn: '3600',
      }),
    };

    const eqty = {
      address: '0xabc',
      chainId: 84532,
      signer: {},
      sign: vi.fn(),
      anchor: vi.fn(),
    };

    const service = new RelayService(eqty as any, {
      relayUrl: 'https://relay.test',
      relayClient: relayClient as any,
      siweClient: siweClient as any,
      storage: storageApi,
      now: () => 1000,
    });

    const ok = await service.ensureAuthenticated();

    expect(ok).toBe(true);
    expect(service.getAuthHeaders()).toEqual({ Authorization: 'Bearer token-1' });
    expect(siweClient.authenticate).toHaveBeenCalledTimes(1);
  });

  it('lists messages from injected relay client', async () => {
    const relayClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ messages: [{ hash: 'h1' }], total: 1, hasMore: false }),
      send: vi.fn(),
      delete: vi.fn(),
    };

    const service = new RelayService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: relayClient as any,
        siweClient: { authenticate: vi.fn().mockResolvedValue({ success: true }) } as any,
        storage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      }
    );

    const result = await service.list();
    expect(result?.messages).toHaveLength(1);
  });
});
