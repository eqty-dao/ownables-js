import { describe, expect, it, vi } from 'vitest';

import { Binary } from 'eqty-core';
import EQTYService from '../src/services/EQTY.service';

describe('EQTYService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (
    address: string,
    chainId: number,
    walletClient?: any,
    publicClient?: any,
    ethereumProvider?: any,
    deps: any = {}
  ) =>
    new EQTYService(address, chainId, walletClient, publicClient, ethereumProvider, {
      ...deps,
      logger: deps.logger ?? logger,
    });

  it('throws for unsupported chain ids', () => {
    expect(
      () =>
        createService('0xabc', 1, {} as any, {} as any, undefined, {
          anchorClient: { anchor: vi.fn() },
          signer: {} as any,
        })
    ).toThrow('Unsupported chain ID');
  });

  it('anchors and submits using injected anchor client', async () => {
    const anchorClient = { anchor: vi.fn().mockResolvedValue('0xtx') };
    const signer = {} as any;

    const service = createService('0xabc', 84532, {} as any, {
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

  it('throws when provider inputs are missing and no ethereum provider is supplied', () => {
    expect(() => createService('0xabc', 84532, undefined, undefined, undefined, {} as any)).toThrow(
      'No Ethereum provider found'
    );
  });

  it('restores queued anchors when submit fails', async () => {
    const anchorClient = { anchor: vi.fn().mockRejectedValue(new Error('anchor failed')) };
    const walletClient = { account: '0xabc', signMessage: vi.fn() };
    const publicClient = { getBlockNumber: vi.fn().mockResolvedValue(1n), getLogs: vi.fn().mockResolvedValue([]) };
    const service = createService('0xabc', 84532, walletClient as any, publicClient as any, undefined, {
      anchorClient,
      signer: {} as any,
    });

    const hash = Binary.fromHex(`0x${'a'.repeat(64)}`);
    await service.anchor(hash);
    await expect(service.submitAnchors()).rejects.toThrow('anchor failed');

    anchorClient.anchor.mockResolvedValueOnce('0xtx');
    await expect(service.submitAnchors()).resolves.toBe('0xtx');
  });

  it('verifies anchors for empty and no-log responses', async () => {
    const walletClient = { account: '0xabc', signMessage: vi.fn() };
    const publicClient = { getBlockNumber: vi.fn().mockResolvedValue(3n), getLogs: vi.fn().mockResolvedValue([]) };
    const service = createService('0xabc', 84532, walletClient as any, publicClient as any, undefined, {
      anchorClient: { anchor: vi.fn() },
      signer: {} as any,
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
    const lockableClient = {
      ownerOf: vi.fn().mockResolvedValue('0xowner'),
      isLocked: vi.fn().mockResolvedValue(true),
      unlockChallenge: vi.fn().mockResolvedValue(`0x${'1'.repeat(64)}`),
      isUnlockProofValid: vi.fn().mockResolvedValue(true),
    };
    const walletClient = {
      account: '0xabc',
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };

    const service = createService('0xabc', 84532, walletClient as any, {
      getBlockNumber: vi.fn(),
      getLogs: vi.fn(),
    } as any, undefined, {
      anchorClient: { anchor: vi.fn() },
      signer: {} as any,
      lockableClient,
    });

    await expect(service.getOwner('0xdef', '1')).resolves.toBe('0xowner');
    await expect(service.isLocked('0xdef', '1')).resolves.toBe(true);
    await expect(service.getUnlockChallenge('0xdef', '1')).resolves.toBe(`0x${'1'.repeat(64)}`);
    await expect(service.signUnlockChallenge(`0x${'2'.repeat(64)}`)).resolves.toBe('0xproof');
    await expect(service.isUnlockProofValid('0xdef', '1', '0xproof')).resolves.toBe(true);
  });

  it('requires wallet account to sign unlock challenge', async () => {
    const service = createService('0xabc', 84532, {} as any, {
      getBlockNumber: vi.fn(),
      getLogs: vi.fn(),
    } as any, undefined, {
      anchorClient: { anchor: vi.fn() },
      signer: {} as any,
      lockableClient: {
        ownerOf: vi.fn(),
        isLocked: vi.fn(),
        unlockChallenge: vi.fn(),
        isUnlockProofValid: vi.fn(),
      },
    });

    await expect(service.signUnlockChallenge(`0x${'2'.repeat(64)}`)).rejects.toThrow(
      'Wallet client account is required'
    );
  });

  it('uses readContract paths when no lockable override is provided', async () => {
    const publicClient = {
      getBlockNumber: vi.fn().mockResolvedValue(1n),
      getLogs: vi.fn().mockResolvedValue([]),
      readContract: vi
        .fn()
        .mockResolvedValueOnce('0xowner')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(123n)
        .mockResolvedValueOnce(true),
    };
    const walletClient = {
      account: '0xabc',
      signMessage: vi.fn().mockResolvedValue('0xproof'),
    };
    const service = createService('0xabc', 84532, walletClient as any, publicClient as any, undefined, {
      anchorClient: { anchor: vi.fn() } as any,
      signer: {} as any,
    });

    await expect(service.getOwner('0xdef', '1')).resolves.toBe('0xowner');
    await expect(service.isLocked('0xdef', '1')).resolves.toBe(true);
    await expect(service.getUnlockChallenge('0xdef', '1')).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    await expect(service.isUnlockProofValid('0xdef', '1', '0xproof')).resolves.toBe(true);
    expect(publicClient.readContract).toHaveBeenCalledTimes(4);
  });

  it('marks verification false for mismatched and failing log reads', async () => {
    const key1 = Binary.fromHex(`0x${'a'.repeat(64)}`);
    const key2 = Binary.fromHex(`0x${'b'.repeat(64)}`);
    const value = Binary.fromHex(`0x${'c'.repeat(64)}`);
    const publicClient = {
      getBlockNumber: vi.fn().mockResolvedValue(5n),
      getLogs: vi
        .fn()
        .mockResolvedValueOnce([
          {
            transactionHash: '0xtx1',
            args: { value: `0x${'d'.repeat(64)}` },
          },
        ])
        .mockRejectedValueOnce(new Error('rpc down')),
      readContract: vi.fn(),
    };
    const service = createService(
      '0xabc',
      84532,
      { account: '0xabc', signMessage: vi.fn() } as any,
      publicClient as any,
      undefined,
      { anchorClient: { anchor: vi.fn() } as any, signer: {} as any }
    );

    const result = await service.verifyAnchors({ key: key1, value }, { key: key2, value });
    expect(result.verified).toBe(false);
    expect(result.anchors[key1.hex]).toBe('0xtx1');
    expect(result.anchors[key2.hex]).toBeUndefined();
    expect(result.map[key1.hex]).toBe(`0x${'d'.repeat(64)}`);
  });
});
