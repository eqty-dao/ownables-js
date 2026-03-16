import { describe, expect, it, vi } from 'vitest';

import OwnableService from '../src/services/Ownable.service';

const basePkg = {
  title: 'Pkg',
  name: 'pkg',
  cid: 'cid-1',
  versions: [{ date: new Date(), cid: 'cid-1' }],
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  isConsumable: false,
  isConsumer: false,
  isTransferable: false,
};

describe('OwnableService', () => {
  it('tracks rpc readiness and throws when missing rpc', () => {
    const service = new OwnableService({} as any, { anchoring: false } as any, {} as any, {} as any);

    expect(service.isReady('id-1')).toBe(false);
    expect(() => service.rpc('id-1')).toThrow('No RPC for ownable id-1');
  });

  it('creates chain without signing when package is static and anchoring disabled', async () => {
    const eqty = {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 84532,
      sign: vi.fn(),
      anchor: vi.fn(),
      submitAnchors: vi.fn(),
    };
    const service = new OwnableService(
      {} as any,
      { anchoring: false, loadAll: vi.fn().mockResolvedValue([]) } as any,
      eqty as any,
      {} as any
    );

    const result = await service.create(basePkg as any);

    expect(result.chain).toBeDefined();
    expect(eqty.sign).not.toHaveBeenCalled();
    expect(eqty.anchor).not.toHaveBeenCalled();
  });

  it('handles Cancelled-like errors when clearing rpc', () => {
    const service = new OwnableService({} as any, { anchoring: false } as any, {} as any, {} as any);

    const rpc = {} as Record<string, unknown>;
    Object.defineProperty(rpc, 'handler', {
      configurable: true,
      get() {
        return true;
      },
      set() {
        const err = new Error('cancelled');
        err.name = 'Cancelled';
        throw err;
      },
    });

    (service as any)._rpc.set('id-1', rpc);
    expect(() => service.clearRpc('id-1')).not.toThrow();
  });
});
