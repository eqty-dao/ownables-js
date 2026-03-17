import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@ownables/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@ownables/platform-browser': fileURLToPath(
        new URL('./packages/platform-browser/src/index.ts', import.meta.url)
      ),
      '@ownables/adapter-viem': fileURLToPath(
        new URL('./packages/adapter-viem/src/index.ts', import.meta.url)
      ),
      '@ownables/adapter-ethers': fileURLToPath(
        new URL('./packages/adapter-ethers/src/index.ts', import.meta.url)
      ),
      '@ownables/builder-client': fileURLToPath(
        new URL('./packages/builder-client/src/index.ts', import.meta.url)
      ),
      '@ownables/platform-node': fileURLToPath(
        new URL('./packages/platform-node/src/index.ts', import.meta.url)
      ),
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
