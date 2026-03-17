import { describe, expect, it, vi } from 'vitest';

import { Binary } from 'eqty-core';
import EQTYService from '../src/services/EQTY.service';

describe('EQTYService', () => {
  it('throws for unsupported chain ids', () => {
    expect(
      () =>
        new EQTYService('0xabc', 1, {} as any, {} as any, undefined, {
          anchorClient: { anchor: vi.fn() },
          signer: {} as any,
        })
    ).toThrow('Unsupported chain ID');
  });

  it('anchors and submits using injected anchor client', async () => {
    const anchorClient = { anchor: vi.fn().mockResolvedValue('0xtx') };
    const signer = {} as any;

    const service = new EQTYService('0xabc', 84532, {} as any, {
      getBlockNumber: vi.fn(),
      getLogs: vi.fn(),
    } as any, undefined, {
      anchorClient,
      signer,
    });

    await service.anchor(Binary.fromHex('0x' + '1'.repeat(64)));
    const tx = await service.submitAnchors();

    expect(tx).toBe('0xtx');
    expect(anchorClient.anchor).toHaveBeenCalledTimes(1);
  });
});
