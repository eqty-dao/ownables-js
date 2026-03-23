import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
  vi.mocked(console.warn).mockRestore();
});
