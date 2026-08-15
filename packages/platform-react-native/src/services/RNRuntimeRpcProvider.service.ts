import type { OwnableRPC, RuntimeRPCProvider } from '@ownables/core';
import RNOwnableRPC from './RNOwnableRPC.service';
import type { RNRuntimeRpcProviderOptions } from '../types/PlatformReactNative';

export class RNRuntimeRpcProvider implements RuntimeRPCProvider {
  constructor(private readonly options: RNRuntimeRpcProviderOptions) {}
  create(id: string): OwnableRPC {
    return new RNOwnableRPC(id, { bridge: this.options.bridge });
  }
}
