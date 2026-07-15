import type { OwnableRPC, RuntimeRPCProvider } from '@ownables/core';
import NodeSandboxOwnableRPC from './NodeSandboxOwnableRPC.service.js';

export class NodeRuntimeRpcProvider implements RuntimeRPCProvider {
  create(id: string): OwnableRPC {
    return new NodeSandboxOwnableRPC(id);
  }
}
