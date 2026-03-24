import { describe, expect, it, vi } from 'vitest';

import { SIWEClient } from '../src/services/SIWE.service';

describe('SIWEClient', () => {
  it('creates deterministic message with injected nonce/time', () => {
    const client = new SIWEClient('relay.test', {
      nonceGenerator: () => 'nonce-123',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const msg = client.createMessage('0xabc', 'https://relay.test/auth/verify', 84532);

    expect(msg.domain).toBe('relay.test');
    expect(msg.nonce).toBe('nonce-123');
    expect(msg.issuedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('authenticates with injected fetch and signer', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: '0xabc', token: 'tkn', expiresIn: '1h' }),
    });

    const signer = {
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
    };

    const client = new SIWEClient('relay.test', { fetchFn });
    const result = await client.authenticate(signer as any, 'https://relay.test', 84532);

    expect(result.success).toBe(true);
    expect(result.token).toBe('tkn');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('signs typed SIWE message payload', async () => {
    const signer = {
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
    };
    const client = new SIWEClient('relay.test', {
      nonceGenerator: () => 'nonce-123',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const msg = client.createMessage('0xabc', 'https://relay.test/auth/verify', 84532);

    await expect(client.signMessage(msg as any, signer as any)).resolves.toBe('0xsig');
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
  });

  it('handles auth non-ok responses and thrown errors', async () => {
    const signer = {
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
    };
    const nonOk = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'denied' }) }),
    });
    await expect(nonOk.authenticate(signer as any, 'https://relay.test', 84532)).resolves.toEqual(
      expect.objectContaining({ success: false, error: 'denied' })
    );

    const throws = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockRejectedValue(new Error('network')),
    });
    await expect(throws.authenticate(signer as any, 'https://relay.test', 84532)).resolves.toEqual(
      expect.objectContaining({ success: false, error: 'Authentication failed: network' })
    );
  });

  it('gets nonce and throws on nonce fetch failures', async () => {
    const okClient = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nonce: 'n1' }) }),
    });
    await expect(okClient.getNonce('https://relay.test')).resolves.toBe('n1');

    const failClient = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    });
    await expect(failClient.getNonce('https://relay.test')).rejects.toThrow('Failed to get nonce');
  });

  it('uses fallback auth/nonce error paths and empty optional SIWE fields', async () => {
    const signer = {
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
    };
    const nonOkWithoutError = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    });
    await expect(
      nonOkWithoutError.authenticate(signer as any, 'https://relay.test', 84532)
    ).resolves.toEqual(expect.objectContaining({ success: false, error: 'Authentication failed' }));

    const thrownNonError = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockRejectedValue('boom-string'),
    });
    await expect(
      thrownNonError.authenticate(signer as any, 'https://relay.test', 84532)
    ).resolves.toEqual(expect.objectContaining({ success: false, error: 'Authentication failed: boom-string' }));

    const nonceThrowNonError = new SIWEClient('relay.test', {
      fetchFn: vi.fn().mockRejectedValue('nonce-down'),
    });
    await expect(nonceThrowNonError.getNonce('https://relay.test')).rejects.toThrow(
      'Failed to get nonce: nonce-down'
    );

    const msg = thrownNonError.createMessage('0xabc', 'https://relay.test/auth/verify', 84532);
    delete (msg as any).statement;
    delete (msg as any).resources;
    await thrownNonError.signMessage(msg as any, signer as any);
    expect(signer.signTypedData).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        statement: '',
        resources: [],
      })
    );
  });
});
