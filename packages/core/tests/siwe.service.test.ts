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
});
