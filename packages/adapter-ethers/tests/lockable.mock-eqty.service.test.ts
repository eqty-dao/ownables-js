import { describe, expect, it } from 'vitest';

import MockEQTYService from '../src/services/MockEQTY.service';

describe('MockEQTYService lockable methods (ethers adapter)', () => {
  it('returns deterministic challenge/proof flow', async () => {
    const service = new MockEQTYService('0xabc', 84532);

    await expect(service.getOwner('0xdef', '1')).resolves.toBe('0xabc');
    await expect(service.isLocked('0xdef', '1')).resolves.toBe(true);

    const challenge = await service.getUnlockChallenge('0xdef', '1');
    const proof = await service.signUnlockChallenge(challenge);

    expect(challenge).toMatch(/^0x[0-9a-f]{64}$/);
    expect(proof).toMatch(/^0x[0-9a-f]{130}$/);
    await expect(service.isUnlockProofValid('0xdef', '1', proof)).resolves.toBe(true);
  });

  it('signs non-hex challenge text and rejects malformed proofs', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    await expect(service.signUnlockChallenge('hello')).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    await expect(service.isUnlockProofValid('0xdef', '1', 'bad')).resolves.toBe(false);
  });
});
