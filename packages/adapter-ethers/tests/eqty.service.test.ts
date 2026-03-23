import { describe, expect, it, vi } from 'vitest';
import { Binary } from 'eqty-core';
import { Interface } from 'ethers';

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

  it('throws when signer is missing or provider is unavailable', () => {
    expect(() => new EQTYService('0xabc', 84532, {} as any)).toThrow('No Ethereum signer found');

    const signer = {
      provider: null,
      getAddress: vi.fn(),
      signTypedData: vi.fn(),
      signMessage: vi.fn(),
    };
    expect(() => new EQTYService('0xabc', 84532, { signer: signer as any })).toThrow(
      'No Ethereum provider found'
    );
  });

  it('restores queued anchors when submit fails', async () => {
    const anchorClient = { anchor: vi.fn().mockRejectedValue(new Error('anchor failed')) };
    const signer = {
      provider: { getBlockNumber: vi.fn().mockResolvedValue(0), getLogs: vi.fn().mockResolvedValue([]) },
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };
    const service = new EQTYService('0xabc', 84532, {
      signer: signer as any,
      deps: { anchorClient, signer: signer as any },
    });

    const hash = Binary.fromHex(`0x${'a'.repeat(64)}`);
    await service.anchor(hash);
    await expect(service.submitAnchors()).rejects.toThrow('anchor failed');

    anchorClient.anchor.mockResolvedValueOnce('0xtx');
    await expect(service.submitAnchors()).resolves.toBe('0xtx');
  });

  it('verifies anchors for empty and log-based responses', async () => {
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(10),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    const signer = {
      provider,
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };
    const service = new EQTYService('0xabc', 84532, {
      signer: signer as any,
      deps: { anchorClient: { anchor: vi.fn() }, signer: signer as any },
    });

    await expect(service.verifyAnchors()).resolves.toEqual({
      verified: false,
      anchors: {},
      map: {},
    });

    const key = Binary.fromHex(`0x${'b'.repeat(64)}`);
    const value = Binary.fromHex(`0x${'0'.repeat(64)}`);
    const result = await service.verifyAnchors({ key, value });
    expect(result.verified).toBe(false);
    expect(result.anchors[key.hex]).toBeUndefined();
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

  it('normalizes bigint unlock challenge and signs utf8 challenge payload', async () => {
    const signer = {
      provider: { getBlockNumber: vi.fn().mockResolvedValue(0), getLogs: vi.fn().mockResolvedValue([]) },
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };
    const lockableClient = {
      ownerOf: vi.fn().mockResolvedValue('0xowner'),
      isLocked: vi.fn().mockResolvedValue(true),
      unlockChallenge: vi.fn().mockResolvedValue(123n),
      isUnlockProofValid: vi.fn().mockResolvedValue(true),
    };
    const service = new EQTYService('0xabc', 84532, {
      signer: signer as any,
      deps: { lockableClient, signer: signer as any, anchorClient: { anchor: vi.fn() } },
    });

    await expect(service.getUnlockChallenge('0xdef', '1')).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    await expect(service.signUnlockChallenge('hello')).resolves.toBe('0xproof');
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('marks verification false on mismatched values and log errors', async () => {
    const key = Binary.fromHex(`0x${'c'.repeat(64)}`);
    const expected = Binary.fromHex(`0x${'d'.repeat(64)}`);
    const iface = new Interface([
      'event Anchored(bytes32 indexed key, bytes32 value, address indexed sender, uint64 timestamp)',
    ]);
    const encoded = iface.encodeEventLog(iface.getEvent('Anchored')!, [
      key.hex,
      `0x${'e'.repeat(64)}`,
      '0x1111111111111111111111111111111111111111',
      1n,
    ]);

    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(10),
      getLogs: vi
        .fn()
        .mockResolvedValueOnce([
          {
            ...encoded,
            transactionHash: '0xtx1',
          },
        ])
        .mockRejectedValueOnce(new Error('rpc down')),
    };
    const signer = {
      provider,
      getAddress: vi.fn().mockResolvedValue('0xabc'),
      signTypedData: vi.fn().mockResolvedValue('0xsig'),
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };
    const service = new EQTYService('0xabc', 84532, {
      signer: signer as any,
      deps: { anchorClient: { anchor: vi.fn() }, signer: signer as any },
    });

    const result = await service.verifyAnchors(
      { key, value: expected },
      { key: Binary.fromHex(`0x${'f'.repeat(64)}`), value: Binary.fromHex(`0x${'0'.repeat(64)}`) }
    );
    expect(result.verified).toBe(false);
    expect(result.anchors[key.hex]).toBe('0xtx1');
    expect(result.map[key.hex]).toBe(`0x${'e'.repeat(64)}`);
  });
});
