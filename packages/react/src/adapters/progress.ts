import type { LogProgress, ProgressReporter } from '@ownables/core/interfaces/core';

export const createProgressReporter = (
  onProgress?: LogProgress
): ProgressReporter => ({
  async step(step, fn, meta) {
    const result = await fn();
    onProgress?.(step, meta ? meta() : undefined);
    return result;
  },
});
