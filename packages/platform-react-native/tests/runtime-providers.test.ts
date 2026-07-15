import { describe, expect, it, vi } from 'vitest';
import { RNRuntimeRpcProvider, RNRuntimeSourceProvider, RNOwnableRPC } from '../src';

describe('React Native runtime providers', () => {
  it('provides configured source and fresh RPC instances', () => {
    const bridge = { createInstance: vi.fn() } as any;
    expect(new RNRuntimeSourceProvider({ workerSource: 'source' }).getWorkerSource()).toBe('source');
    const provider = new RNRuntimeRpcProvider({ bridge });
    const first = provider.create('one');
    const second = provider.create('two');
    expect(first).toBeInstanceOf(RNOwnableRPC);
    expect(second).toBeInstanceOf(RNOwnableRPC);
    expect(first).not.toBe(second);
  });
});
