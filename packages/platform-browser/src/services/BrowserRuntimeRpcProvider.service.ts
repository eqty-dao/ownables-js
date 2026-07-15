import { WorkerRPC } from '@ownables/core';
import type { OwnableRPC, RuntimeRPCProvider } from '@ownables/core';

export class BrowserRuntimeRpcProvider implements RuntimeRPCProvider {
  create(id: string): OwnableRPC {
    return new WorkerRPC(id);
  }
}
