import { readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineWorkspace } from 'vitest/config';

const packagesDir = fileURLToPath(new URL('./packages', import.meta.url));
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

export default defineWorkspace(
  packageDirs.map((pkg) => ({
    extends: './vitest.config.ts',
    test: {
      name: pkg,
      include: [`packages/${pkg}/src/**/*.test.ts`, `packages/${pkg}/tests/**/*.test.ts`],
    },
  }))
);
