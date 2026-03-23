import { describe, expect, it, vi } from 'vitest';

import { Binary } from 'eqty-core';
import MockEQTYService from '../src/services/MockEQTY.service';

describe('MockEQTYService', () => {
  it('queues anchors and returns tx hash on submit', async () => {
    const service = new MockEQTYService('0xabc', 84532);

    await service.anchor(Binary.fromHex('0x' + '1'.repeat(64)));
    const tx = await service.submitAnchors();

    expect(tx).toMatch(/^0x[a]+$/);
  });

  it('handles empty submit and key/value anchor input', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    await expect(service.anchor()).resolves.toBeUndefined();
    await expect(service.submitAnchors()).resolves.toBeUndefined();

    await service.anchor({
      key: Binary.fromHex('0x' + '4'.repeat(64)),
      value: Binary.fromHex('0x' + '5'.repeat(64)),
    } as any);
    await expect(service.submitAnchors()).resolves.toMatch(/^0x[a]+$/);
  });

  it('verifies anchor map deterministically', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    const key = Binary.fromHex('0x' + '2'.repeat(64));
    const value = Binary.fromHex('0x' + '3'.repeat(64));

    const result = await service.verifyAnchors({ key, value });

    expect(result.verified).toBe(true);
    expect(result.map[key.hex]).toBe(value.hex.toLowerCase());
  });

  it('verifies binary anchor list with zero hash defaults', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    const key = Binary.fromHex('0x' + '6'.repeat(64));
    const result = await service.verifyAnchors(key);

    expect(result.verified).toBe(true);
    expect(result.anchors[key.hex]).toMatch(/^0x[b]+$/);
    expect(result.map[key.hex]).toBe(`0x${'0'.repeat(64)}`);
  });

  it('delegates sign to mock signer and exposes deterministic signer methods', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    const subject = { signWith: vi.fn().mockResolvedValue(undefined) };

    await service.sign(subject as any);
    await expect((service.signer as any).getAddress()).resolves.toBe('0xabc');
    await expect(
      (service.signer as any).signTypedData({} as any, {} as any, {} as any)
    ).resolves.toMatch(/^0x[1]{130}$/);
    expect(subject.signWith).toHaveBeenCalledWith(service.signer);
  });

  it('signs non-hex challenge strings and validates malformed proofs', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    await expect(service.signUnlockChallenge('hello')).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    await expect(service.isUnlockProofValid('0xdef', '1', 'bad')).resolves.toBe(false);
  });
});
