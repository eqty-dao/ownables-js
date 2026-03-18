import { describe, expect, it, vi } from 'vitest';
import { Binary } from 'eqty-core';

import EQTYService from '../src/services/EQTY.service';

describe('Ethers EQTYService', () => {
  it('throws for unsupported chain ids', () => {
    const signer = {
      provider: { getBlockNumber: vi.fn(), getLogs: vi.fn() },
      getAddress: vi.fn(),
      signTypedData: vi.fn(),
    };

    expect(() => new EQTYService('0xabc', 1, { signer: signer as any })).toThrow(
      'Unsupported chain ID'
    );
  });

  it('anchors and submits with injected anchor client', async () => {
    const anchorClient = { anchor: vi.fn().mockResolvedValue('0xtx') };
    const signer = {
      provider: { getBlockNumber: vi.fn().mockResolvedValue(0), getLogs: vi.fn().mockResolvedValue([]) },
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
    };

    const service = new EQTYService('0xabc', 84532, {
      signer: signer as any,
      deps: {
        anchorClient,
        signer: signer as any,
      },
    });

    await service.anchor(Binary.fromHex(`0x${'1'.repeat(64)}`));
    const tx = await service.submitAnchors();

    expect(tx).toBe('0xtx');
    expect(anchorClient.anchor).toHaveBeenCalledTimes(1);
  });

  it('provides lockable operations through injected lockable client', async () => {
    const signer = {
      provider: { getBlockNumber: vi.fn().mockResolvedValue(0), getLogs: vi.fn().mockResolvedValue([]) },
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };
    const lockableClient = {
      ownerOf: vi.fn().mockResolvedValue('0xowner'),
      isLocked: vi.fn().mockResolvedValue(true),
      unlockChallenge: vi.fn().mockResolvedValue(`0x${'1'.repeat(64)}`),
      isUnlockProofValid: vi.fn().mockResolvedValue(true),
    };

    const service = new EQTYService('0xabc', 84532, {
      signer: signer as any,
      deps: { lockableClient, signer: signer as any, anchorClient: { anchor: vi.fn() } },
    });

    await expect(service.getOwner('0xdef', '1')).resolves.toBe('0xowner');
    await expect(service.isLocked('0xdef', '1')).resolves.toBe(true);
    await expect(service.getUnlockChallenge('0xdef', '1')).resolves.toBe(`0x${'1'.repeat(64)}`);
    await expect(service.signUnlockChallenge(`0x${'2'.repeat(64)}`)).resolves.toBe('0xproof');
    await expect(service.isUnlockProofValid('0xdef', '1', '0xproof')).resolves.toBe(true);
  });
});
