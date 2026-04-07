import type { RuntimeSourceProvider } from '@ownables/core';
import type { RNRuntimeSourceProviderOptions } from '../types/PlatformReactNative';

export function createRNRuntimeSourceProvider(
  options: RNRuntimeSourceProviderOptions = {}
): RuntimeSourceProvider {
  return {
    getWorkerSource: () => options.workerSource ?? '',
  };
}
