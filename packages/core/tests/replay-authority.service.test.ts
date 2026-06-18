import { describe, expect, it, vi } from 'vitest';

import OwnableService from '../src/services/Ownable.service';
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
      attemptReplayIndexedPublicEvents: vi.fn().mockResolvedValue({
        complete: true,
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
    expect(ownables.attemptReplayIndexedPublicEvents).toHaveBeenCalledWith(chain.id, stateDump, indexedPublicEvents);
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
    const stateDump = [['base', 1]] as any;
    const indexedPublicEvents = [
      makeEvent('0xaaa', 1, 10, 0),
      makeEvent('0xbbb', 2, 11, 0),
      makeEvent('0xccc', 3, 12, 0),
    ];
    const register = vi
      .fn()
      .mockResolvedValueOnce({ state: [['after-first', 1]] })
      .mockRejectedValueOnce(new Error('missing private event'));
    const query = vi.fn().mockResolvedValue({ owner: '0x1', issuer: '0x2' });
    const ownables = new OwnableService(
      {} as any,
      {} as any,
      { address: '0xabc' } as any,
      {} as any
    );
    (ownables as any)._rpc.set(chain.id, {
      register,
      query,
    });

    const service = new ReplayAuthorityService({
      eventChains: { verify: vi.fn().mockResolvedValue({ verified: true }) } as any,
      ownables,
    });

    const result = await service.evaluate({
      chain,
      stateDump,
      indexedPublicEvents,
    });

    expect(register).toHaveBeenCalledTimes(2);
    expect(result.replay.complete).toBe(false);
    expect(result.replay.failure?.replayKey).toBe(publicEventReplayKey(indexedPublicEvents[1]!));
    expect(result.replay.appliedReplayKeys).toEqual([publicEventReplayKey(indexedPublicEvents[0]!)]);
    expect(result.freshness).toEqual({
      stale: true,
      missingReplayKeys: ['0xbbb:2', '0xccc:3'],
      latestReplayKey: '0xccc:3',
    });
    expect(query).toHaveBeenCalledWith({ get_info: {} }, [['after-first', 1]]);
  });
});
