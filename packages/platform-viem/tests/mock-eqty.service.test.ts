import { describe, expect, it } from 'vitest';

import { Binary } from 'eqty-core';
import MockEQTYService from '../src/services/MockEQTY.service';

describe('MockEQTYService', () => {
  it('queues anchors and returns tx hash on submit', async () => {
    const service = new MockEQTYService('0xabc', 84532);

    await service.anchor(Binary.fromHex('0x' + '1'.repeat(64)));
    const tx = await service.submitAnchors();

    expect(tx).toMatch(/^0x[a]+$/);
  });

  it('verifies anchor map deterministically', async () => {
    const service = new MockEQTYService('0xabc', 84532);
    const key = Binary.fromHex('0x' + '2'.repeat(64));
    const value = Binary.fromHex('0x' + '3'.repeat(64));

    const result = await service.verifyAnchors({ key, value });

    expect(result.verified).toBe(true);
    expect(result.map[key.hex]).toBe(value.hex.toLowerCase());
  });
});
