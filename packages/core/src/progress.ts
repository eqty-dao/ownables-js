import type { LogProgress, ProgressReporter } from './interfaces/core';

export const withProgress = (onProgress?: LogProgress): ProgressReporter['step'] => {
  return async (step, fn, meta) => {
    const result = await fn();
    onProgress?.(step, meta ? meta() : undefined);
    return result;
  };
};
