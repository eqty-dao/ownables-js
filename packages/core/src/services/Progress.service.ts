import type { LogProgress, ProgressReporter } from '../interfaces/core.js';

export class ProgressService implements ProgressReporter {
  constructor(private readonly onProgress?: LogProgress) {}

  async step<T>(
    step: string,
    fn: () => Promise<T> | T,
    meta?: () => Record<string, unknown>
  ): Promise<T> {
    const result = await fn();
    this.onProgress?.(step, meta ? meta() : undefined);
    return result;
  }
}
