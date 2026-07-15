import { describe, expect, it, vi } from 'vitest';

import { ProgressService } from '../src/services/Progress.service';

describe('ProgressService', () => {
  it('returns the operation result before reporting lazily evaluated metadata', async () => {
    const order: string[] = [];
    const onProgress = vi.fn(() => order.push('progress'));
    const meta = vi.fn(() => {
      order.push('meta');
      return { hash: 'abc' };
    });
    const progress = new ProgressService(onProgress);

    const result = await progress.step(
      'signEvent',
      async () => {
        order.push('operation');
        return 42;
      },
      meta
    );

    expect(result).toBe(42);
    expect(order).toEqual(['operation', 'meta', 'progress']);
    expect(onProgress).toHaveBeenCalledWith('signEvent', { hash: 'abc' });
  });

  it('does not report progress or evaluate metadata when the operation throws', async () => {
    const error = new Error('failed');
    const onProgress = vi.fn();
    const meta = vi.fn(() => ({ hash: 'abc' }));
    const progress = new ProgressService(onProgress);

    await expect(
      progress.step('signEvent', () => Promise.reject(error), meta)
    ).rejects.toBe(error);
    expect(onProgress).not.toHaveBeenCalled();
    expect(meta).not.toHaveBeenCalled();
  });
});
