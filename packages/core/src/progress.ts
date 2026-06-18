import type { LogProgress, ProgressReporter } from './interfaces/core.js';

export const withProgress = (onProgress?: LogProgress): ProgressReporter['step'] => {
  return async (step, fn, meta) => {
    const result = await fn();
    onProgress?.(step, meta ? meta() : undefined);
    return result;
  };
};
