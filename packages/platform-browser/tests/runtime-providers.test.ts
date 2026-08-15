import { describe, expect, it } from 'vitest';
import { BrowserRuntimeRpcProvider, BrowserRuntimeSourceProvider } from '../src';
import { WorkerRPC } from '@ownables/core';

describe('browser runtime providers', () => {
  it('provides the default worker bootstrap and fresh RPC instances', () => {
    expect(new BrowserRuntimeSourceProvider().getWorkerSource()).toContain(
      'WASM instantiated successfully'
    );
    const provider = new BrowserRuntimeRpcProvider();
    const first = provider.create('one');
    const second = provider.create('two');
    expect(first).toBeInstanceOf(WorkerRPC);
    expect(second).toBeInstanceOf(WorkerRPC);
    expect(first).not.toBe(second);
  });
});
