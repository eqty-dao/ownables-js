import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILT_INDEX_PATH = `${PACKAGE_ROOT}/${packageJson.main}`;
const BUILT_TYPES_PATH = `${PACKAGE_ROOT}/${packageJson.types}`;

describe('@ownables/core package root', () => {
  it('exports ProgressService without removed function helpers', async () => {
    await execFileAsync('yarn', ['workspace', '@ownables/core', 'build'], {
      cwd: REPO_ROOT,
    });

    await access(BUILT_INDEX_PATH);
    await access(BUILT_TYPES_PATH);

    const builtModule = await import(pathToFileURL(BUILT_INDEX_PATH).href);

    expect(builtModule.ProgressService).toBeTypeOf('function');
    expect(builtModule.withProgress).toBeUndefined();
    expect(builtModule.ownableErrorMessage).toBeUndefined();
  }, 15000);
});
