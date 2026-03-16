import { describe, expect, it, vi } from 'vitest';

import EventChainService from '../src/services/EventChain.service';

describe('EventChainService', () => {
  it('reads and updates anchoring via injected settings store', () => {
    const settings = {
      get: vi.fn().mockReturnValue(false),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };

    const service = new EventChainService({} as any, {} as any, settings as any);
    expect(service.anchoring).toBe(false);

    service.setAnchoring(true);
    expect(settings.set).toHaveBeenCalledWith('anchoring', true);
  });

  it('delegates verify to anchor provider', async () => {
    const eqty = {
      verifyAnchors: vi.fn().mockResolvedValue({ verified: true, anchors: {}, map: {} }),
    };

    const service = new EventChainService({} as any, eqty as any);
    const result = await service.verify({ anchorMap: [{ key: { hex: '0x1' }, value: { hex: '0x2' } }] } as any);

    expect(result.verified).toBe(true);
    expect(eqty.verifyAnchors).toHaveBeenCalledTimes(1);
  });
});
