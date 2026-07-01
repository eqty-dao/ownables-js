import { describe, expect, it } from 'vitest';
import {
  calculateOwnablePackageCid,
  dedupeIndexedPublicEvents,
  evaluateReplayFreshness,
  publicEventReplayKey,
  selectReplayableIndexedPublicEvents,
  validateAnchorsAgainstIndexedRecords,
} from './index.js';

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
    expect(deduped.duplicateEvents).toEqual([events[2]]);
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

  it('shares the same anchor validation result shape for indexed evidence', () => {
    const result = validateAnchorsAgainstIndexedRecords(
      [{ key: { hex: `0x${'a'.repeat(64)}` }, value: { hex: `0x${'b'.repeat(64)}` } }],
      [
        {
          key: `0x${'a'.repeat(64)}`,
          value: `0x${'b'.repeat(64)}`,
          transactionHash: '0xtx1',
          timestamp: 11,
          blockNumber: 2,
          transactionIndex: 1,
          logIndex: 0,
        },
      ]
    );

    expect(result).toEqual({
      verified: true,
      anchors: {
        [`0x${'a'.repeat(64)}`]: '0xtx1',
      },
      map: {
        [`0x${'a'.repeat(64)}`]: `0x${'b'.repeat(64)}`,
      },
      details: {
        [`0x${'a'.repeat(64)}`]: {
          key: `0x${'a'.repeat(64)}`,
          expectedValue: `0x${'b'.repeat(64)}`,
          value: `0x${'b'.repeat(64)}`,
          transactionHash: '0xtx1',
          timestamp: 11,
          blockNumber: 2,
          transactionIndex: 1,
          logIndex: 0,
          verified: true,
          source: 'indexed',
        },
      },
    });
  });

  it('selects replayable public events by proven private prefix and falls back to timestamps only in development', () => {
    const privateEvents = [
      { hash: '0xpriv1', timestamp: 10 },
      { hash: '0xpriv2', timestamp: 20 },
      { hash: '0xpriv3', timestamp: 30 },
    ];
    const publicEvents = [
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x11',
        blockNumber: 11,
        transactionHash: '0xaaa',
        transactionIndex: 0,
        logIndex: 1,
        timestamp: 15,
      },
      {
        source: '0xsource',
        eventType: 'consume',
        data: '0x22',
        blockNumber: 13,
        transactionHash: '0xbbb',
        transactionIndex: 0,
        logIndex: 2,
        timestamp: 35,
      },
    ];

    const anchoredSelection = selectReplayableIndexedPublicEvents(publicEvents, {
      privateEvents,
      privatePrefixLength: 1,
      anchorValidation: {
        verified: true,
        anchors: { '0xpriv1': '0xtx1', '0xpriv2': '0xtx2', '0xpriv3': '0xtx3' },
        map: { '0xpriv1': '0x01', '0xpriv2': '0x02', '0xpriv3': '0x03' },
        details: {
          '0xpriv1': {
            key: '0xpriv1',
            expectedValue: '0x01',
            value: '0x01',
            transactionHash: '0xtx1',
            timestamp: 10,
            verified: true,
            source: 'provider',
          },
          '0xpriv2': {
            key: '0xpriv2',
            expectedValue: '0x02',
            value: '0x02',
            transactionHash: '0xtx2',
            timestamp: 20,
            verified: true,
            source: 'provider',
          },
          '0xpriv3': {
            key: '0xpriv3',
            expectedValue: '0x03',
            value: '0x03',
            transactionHash: '0xtx3',
            timestamp: 30,
            verified: true,
            source: 'provider',
          },
        },
      },
    });

    expect(anchoredSelection.events).toEqual([publicEvents[0]]);
    expect(anchoredSelection.ignoredPublicEvents).toEqual([
      {
        replayKey: '0xbbb:2',
        event: publicEvents[1],
        reason: 'missing_private_prefix',
        cause: {
          privatePrefixLength: 1,
          usedTimestampFallback: false,
        },
      },
    ]);

    const devFallbackSelection = selectReplayableIndexedPublicEvents(publicEvents, {
      privateEvents,
      privatePrefixLength: 1,
      mode: 'development',
    });
    expect(devFallbackSelection.events).toEqual([publicEvents[0]]);

    const productionSelection = selectReplayableIndexedPublicEvents(publicEvents, {
      privateEvents,
      privatePrefixLength: 1,
    });
    expect(productionSelection.events).toEqual([]);
    expect(productionSelection.ignoredPublicEvents[0]?.reason).toBe('missing_private_prefix');
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
