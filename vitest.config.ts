import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@ownables/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@ownables/platform-browser': fileURLToPath(
        new URL('./packages/platform-browser/src/index.ts', import.meta.url)
      ),
      '@ownables/platform-viem': fileURLToPath(
        new URL('./packages/platform-viem/src/index.ts', import.meta.url)
      ),
      '@ownables/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage'
    }
  }
});
