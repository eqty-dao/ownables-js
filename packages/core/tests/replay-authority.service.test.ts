import { describe, expect, it, vi } from 'vitest';

import { ReplayAuthorityService, publicEventReplayKey } from '../src/services/ReplayAuthority.service';

const makeEvent = (
  transactionHash: string,
  logIndex: number,
  blockNumber: number,
  transactionIndex: number
) => ({
  source: '0xsource',
  eventType: 'consume',
  data: '0x11',
  blockNumber,
  transactionHash,
  transactionIndex,
  logIndex,
});

describe('ReplayAuthorityService', () => {
  it('returns anchor verification, replay metadata, freshness, owner, and ownable info', async () => {
    const chain = { id: 'chain-1' } as any;
    const stateDump = [['s', 1]] as any;
    const indexedPublicEvents = [
      makeEvent('0xbbb', 4, 12, 1),
      makeEvent('0xaaa', 8, 10, 2),
      makeEvent('0xbbb', 4, 12, 1),
    ];
    const eventChains = {
      verify: vi.fn().mockResolvedValue({ verified: true, anchors: {}, map: {} }),
    } as any;
    const ownableInfo = {
      owner: '0x2222222222222222222222222222222222222222',
      issuer: '0x1111111111111111111111111111111111111111',
      nft: {
        network: 'base',
        address: '0x3333333333333333333333333333333333333333',
        id: '77',
      },
    };
    const ownables = {
      replayIndexedPublicEvents: vi.fn().mockResolvedValue({
        stateDump: [['next', 1]],
        appliedEvents: [indexedPublicEvents[1], indexedPublicEvents[0]],
        appliedReplayKeys: [
          publicEventReplayKey(indexedPublicEvents[1]!),
          publicEventReplayKey(indexedPublicEvents[0]!),
        ],
        duplicateReplayKeys: [publicEventReplayKey(indexedPublicEvents[2]!)],
      }),
      rpc: vi.fn().mockReturnValue({
        query: vi.fn().mockResolvedValue(ownableInfo),
      }),
    } as any;

    const service = new ReplayAuthorityService({ eventChains, ownables });
    const result = await service.evaluate({ chain, stateDump, indexedPublicEvents });

    expect(eventChains.verify).toHaveBeenCalledWith(chain);
    expect(ownables.replayIndexedPublicEvents).toHaveBeenCalledWith(chain.id, stateDump, indexedPublicEvents);
    expect(ownables.rpc).toHaveBeenCalledWith(chain.id);
    expect(result.anchorVerification).toEqual({ verified: true, anchors: {}, map: {} });
    expect(result.replay.appliedReplayKeys).toEqual(['0xaaa:8', '0xbbb:4']);
    expect(result.replay.duplicateReplayKeys).toEqual(['0xbbb:4']);
    expect(result.freshness).toEqual({
      stale: false,
      missingReplayKeys: [],
      latestReplayKey: '0xbbb:4',
    });
    expect(result.owner).toBe(ownableInfo.owner);
    expect(result.ownableInfo).toEqual(ownableInfo);
  });

  it('marks stale when indexed events cannot be fully replayed', async () => {
    const chain = { id: 'chain-2' } as any;
    const indexedPublicEvents = [
      makeEvent('0xaaa', 1, 10, 0),
      makeEvent('0xbbb', 2, 11, 0),
    ];
    const service = new ReplayAuthorityService({
      eventChains: { verify: vi.fn().mockResolvedValue({ verified: true }) } as any,
      ownables: {
        replayIndexedPublicEvents: vi.fn().mockResolvedValue({
          stateDump: [] as any,
          appliedEvents: [indexedPublicEvents[0]],
          appliedReplayKeys: [publicEventReplayKey(indexedPublicEvents[0]!)],
          duplicateReplayKeys: [],
        }),
        rpc: vi.fn().mockReturnValue({
          query: vi.fn().mockResolvedValue({ owner: '0x1', issuer: '0x2' }),
        }),
      } as any,
    });

    const result = await service.evaluate({
      chain,
      stateDump: [] as any,
      indexedPublicEvents,
    });

    expect(result.freshness).toEqual({
      stale: true,
      missingReplayKeys: ['0xbbb:2'],
      latestReplayKey: '0xbbb:2',
    });
  });
});
