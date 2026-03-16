import { describe, expect, it, vi } from 'vitest';

import { createProgressReporter } from '../src/adapters/progress';

describe('createProgressReporter', () => {
  it('runs step and reports progress', async () => {
    const onProgress = vi.fn();
    const reporter = createProgressReporter(onProgress);

    const value = await reporter.step('sign', async () => 42, () => ({ hash: 'h1' }));

    expect(value).toBe(42);
    expect(onProgress).toHaveBeenCalledWith('sign', { hash: 'h1' });
  });
});
