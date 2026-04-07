import type { RuntimeRPCProvider } from '@ownables/core';
import RNOwnableRPC from './RNOwnableRPC.service';
import type { RNRuntimeRpcProviderOptions } from '../types/PlatformReactNative';

export function createRNRuntimeRpcProvider(
  options: RNRuntimeRpcProviderOptions
): RuntimeRPCProvider {
  return {
    create: (id: string) => new RNOwnableRPC(id, { bridge: options.bridge }),
  };
}
