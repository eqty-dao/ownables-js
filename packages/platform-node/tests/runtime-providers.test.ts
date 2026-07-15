import { describe, expect, it } from 'vitest';
import { NodeRuntimeRpcProvider, NodeRuntimeSourceProvider, NodeSandboxOwnableRPC } from '../src';

describe('node runtime providers', () => {
  it('provides the empty node source and fresh sandbox RPC instances', () => {
    expect(new NodeRuntimeSourceProvider().getWorkerSource()).toBe('');
    const provider = new NodeRuntimeRpcProvider();
    const first = provider.create('one');
    const second = provider.create('two');
    expect(first).toBeInstanceOf(NodeSandboxOwnableRPC);
    expect(second).toBeInstanceOf(NodeSandboxOwnableRPC);
    expect(first).not.toBe(second);
  });
});
