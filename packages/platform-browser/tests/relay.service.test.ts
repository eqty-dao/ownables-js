import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { RelayService } from '../src/services/Relay.service';

describe('RelayService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (eqty: any, options: any = {}) =>
    new RelayService(eqty, { ...options, logger: options.logger ?? logger });

  it('clears wallet auth token via static helper', () => {
    const removeItem = vi.fn();
    RelayService.clearWalletAuth('0xabc', 84532, { removeItem } as any);
    expect(removeItem).toHaveBeenCalledWith('relay_siwe_token:0xabc:84532');
  });

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

    const service = createService(eqty as any, {
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

  it('returns false from ensureAuthenticated when auth fails', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn().mockResolvedValue({ success: false }) } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    await expect(service.ensureAuthenticated()).resolves.toBe(false);
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

    const service = createService(
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

  it('returns empty auth headers when token is expired', async () => {
    const key = 'relay_siwe_token:0xabc:84532';
    const storageApi = {
      getItem: (storageKey: string) =>
        storageKey === key ? JSON.stringify({ token: 'old', expiry: 1000 }) : null,
      setItem: () => undefined,
      removeItem: vi.fn(),
    };

    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn().mockResolvedValue({ success: false }) } as any,
        storage: storageApi,
        now: () => 2000,
      }
    );

    expect(service.getAuthHeaders()).toEqual({});
    expect(storageApi.removeItem).toHaveBeenCalledWith(key);
  });

  it('returns false from isAvailable when relay throws', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn().mockRejectedValue(new Error('down')) } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    await expect(service.isAvailable()).resolves.toBe(false);
  });

  it('handles list responses as arrays and defaults', async () => {
    const relayClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce([{ hash: 'a1' }])
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
      send: vi.fn(),
      delete: vi.fn(),
    };
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: relayClient as any,
        siweClient: { authenticate: vi.fn().mockResolvedValue({ success: true, token: 't' }) } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    const asArray = await service.list();
    expect(asArray).toEqual({ messages: [{ hash: 'a1' }], total: 1, hasMore: false });

    const defaults = await service.list();
    expect(defaults).toEqual({ messages: [], total: 0, hasMore: false });
  });

  it('throws when removing ownable fails', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: {
          get: vi.fn().mockResolvedValue({}),
          delete: vi.fn().mockRejectedValue(new Error('delete failed')),
        } as any,
        siweClient: { authenticate: vi.fn().mockResolvedValue({ success: true, token: 't' }) } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    await expect(service.removeOwnable('hash-1')).rejects.toThrow('Failed to remove ownable from Relay');
  });

  it('throws when sendOwnable recipient is missing', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {}, sign: vi.fn(), anchor: vi.fn() } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn(), send: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    await expect(service.sendOwnable('', new Uint8Array([1]), {} as any)).rejects.toThrow(
      'Recipient not provided'
    );
  });

  it('returns null from list when relay is unavailable', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: '',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );
    await expect(service.list()).resolves.toBeNull();
  });

  it('handles readMessage invalid response shapes', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: {
          get: vi.fn().mockResolvedValueOnce('bad-response').mockResolvedValueOnce({}),
        } as any,
        siweClient: { authenticate: vi.fn().mockResolvedValue({ success: true, token: 't' }) } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    await expect(service.readMessage('h1')).rejects.toThrow('Invalid response format');
    await expect(service.readMessage('h2')).rejects.toThrow('Failed to create message from JSON');
  });

  it('readAll filters failed message reads', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );
    vi.spyOn(service, 'list').mockResolvedValue({ messages: [{ hash: 'h1' }, { hash: 'h2' }], total: 2, hasMore: false });
    vi.spyOn(service, 'readMessage')
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ message: { ok: true }, hash: 'h2' });

    const result = await service.readAll();
    expect(result).toEqual([{ message: { ok: true }, hash: 'h2' }]);
  });

  it('returns empty list from readAll when list is null', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );
    vi.spyOn(service, 'list').mockResolvedValue(null);
    await expect(service.readAll()).resolves.toEqual([]);
  });

  it('filters duplicate messages to latest chain events', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );

    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([{ name: 'chain.json', text: async () => '{}' }]);
    vi.spyOn(service as any, 'getChainJson')
      .mockResolvedValueOnce({ id: 'c1', events: [1] })
      .mockResolvedValueOnce({ id: 'c1', events: [1, 2] })
      .mockResolvedValueOnce({ id: 'c2', events: [1] });

    const messages = [
      { message: { data: { buffer: new Uint8Array([1]) } }, messageHash: 'h1' },
      { message: { data: { buffer: new Uint8Array([2]) } }, messageHash: 'h2' },
      { message: { data: { buffer: new Uint8Array([3]) } }, messageHash: 'h3' },
      { message: null, messageHash: 'hx' } as any,
    ];

    const deduped = await service.checkDuplicateMessage(messages as any);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((m) => m.messageHash).sort()).toEqual(['h2', 'h3']);
  });

  it('extracts assets from JSZip and skips hidden files', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );
    const zip = new JSZip();
    zip.file('chain.json', JSON.stringify({ id: 'c1', events: [] }));
    zip.file('.hidden', 'x');

    const files = await service.extractAssets(zip);
    expect(files.map((f) => f.name)).toEqual(['chain.json']);
  });

  it('throws when chain asset is missing while de-duping', async () => {
    const service = createService(
      { address: '0xabc', chainId: 84532, signer: {} } as any,
      {
        relayUrl: 'https://relay.test',
        relayClient: { get: vi.fn() } as any,
        siweClient: { authenticate: vi.fn() } as any,
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      }
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([]);

    await expect(
      service.checkDuplicateMessage([{ message: { data: { buffer: new Uint8Array([1]) } }, messageHash: 'h1' }] as any)
    ).rejects.toThrow('Invalid package: missing chain.json');
  });
});
