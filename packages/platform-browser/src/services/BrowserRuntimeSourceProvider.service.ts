import type { RuntimeSourceProvider } from '@ownables/core';
import { DEFAULT_WORKER_SOURCE } from '../assets/workerSource.js';

export class BrowserRuntimeSourceProvider implements RuntimeSourceProvider {
  constructor(private readonly workerSource: string = DEFAULT_WORKER_SOURCE) {}
  getWorkerSource(): string {
    return this.workerSource;
  }
}
