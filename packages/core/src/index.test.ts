import { describe, expect, it } from 'vitest';
import {
  calculateOwnablePackageCid,
  dedupeIndexedPublicEvents,
  evaluateReplayFreshness,
  publicEventReplayKey,
} from './index';

describe('core package', () => {
  it('has test harness', () => {
    expect(true).toBe(true);
  });

  it('exposes deterministic replay key and dedupe helpers', () => {
    const events = [
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x11',
        blockNumber: 12,
        transactionHash: '0xbbb',
        transactionIndex: 1,
        logIndex: 4,
      },
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x11',
        blockNumber: 10,
        transactionHash: '0xaaa',
        transactionIndex: 2,
        logIndex: 8,
      },
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x11',
        blockNumber: 12,
        transactionHash: '0xbbb',
        transactionIndex: 1,
        logIndex: 4,
      },
    ];
    const deduped = dedupeIndexedPublicEvents(events);

    expect(publicEventReplayKey(events[0]!)).toBe('0xbbb:4');
    expect(deduped.events.map((event) => `${event.transactionHash}:${event.logIndex}`)).toEqual([
      '0xaaa:8',
      '0xbbb:4',
    ]);
    expect(deduped.duplicateReplayKeys).toEqual(['0xbbb:4']);
  });

  it('classifies stale indexed public events from missing replay keys', () => {
    const events = [
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x11',
        blockNumber: 10,
        transactionHash: '0xaaa',
        transactionIndex: 0,
        logIndex: 1,
      },
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x22',
        blockNumber: 11,
        transactionHash: '0xbbb',
        transactionIndex: 0,
        logIndex: 2,
      },
    ];

    expect(evaluateReplayFreshness(events, ['0xaaa:1'])).toEqual({
      stale: true,
      missingReplayKeys: ['0xbbb:2'],
      latestReplayKey: '0xbbb:2',
    });
    expect(evaluateReplayFreshness(events, ['0xaaa:1', '0xbbb:2']).stale).toBe(false);
  });

  it('calculates cid while ignoring chain metadata files', async () => {
    const cidA = await calculateOwnablePackageCid([
      { path: 'a.txt', content: Uint8Array.from([1]) },
      { path: 'b.txt', content: Uint8Array.from([2]) },
    ]);

    const cidB = await calculateOwnablePackageCid([
      { path: 'a.txt', content: Uint8Array.from([1]) },
      { path: 'b.txt', content: Uint8Array.from([2]) },
      { path: 'chain.json', content: Uint8Array.from([3]) },
      { path: 'timestamp.txt', content: Uint8Array.from([4]) },
    ]);

    expect(cidA).toBe(cidB);
  });
});
