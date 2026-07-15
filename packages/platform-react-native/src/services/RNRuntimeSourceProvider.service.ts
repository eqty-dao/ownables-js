import type { RuntimeSourceProvider } from '@ownables/core';
import type { RNRuntimeSourceProviderOptions } from '../types/PlatformReactNative';

export class RNRuntimeSourceProvider implements RuntimeSourceProvider {
  constructor(private readonly options: RNRuntimeSourceProviderOptions = {}) {}
  getWorkerSource(): string { return this.options.workerSource ?? ''; }
}
