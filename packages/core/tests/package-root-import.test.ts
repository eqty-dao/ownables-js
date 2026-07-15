import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILT_INDEX_PATH = `${PACKAGE_ROOT}/${packageJson.main}`;
const BUILT_TYPES_PATH = `${PACKAGE_ROOT}/${packageJson.types}`;
const BUILT_UTILS_PATH = `${PACKAGE_ROOT}/dist/utils.js`;
const BUILT_UTILS_TYPES_PATH = `${PACKAGE_ROOT}/dist/utils.d.ts`;

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
    const removedCidService = ['OwnablePackage', 'CidService'].join('');
    expect(builtModule[removedCidService]).toBeUndefined();
    expect(builtModule.calculateOwnablePackageCid).toBeUndefined();

    const rootDeclarations = await readFile(BUILT_TYPES_PATH, 'utf8');
    expect(rootDeclarations).not.toContain('OwnablePackageCidEntry');
    expect(rootDeclarations).not.toContain('calculateOwnablePackageCid');
  }, 15000);

  it('exposes package CID calculation exclusively from the built utility subpath', async () => {
    await execFileAsync('yarn', ['workspace', '@ownables/core', 'build'], {
      cwd: REPO_ROOT,
    });

    await access(BUILT_UTILS_PATH);
    await access(BUILT_UTILS_TYPES_PATH);

    const utilityDeclarations = await readFile(BUILT_UTILS_TYPES_PATH, 'utf8');
    expect(utilityDeclarations).toContain('OwnablePackageCidEntry');
    expect(utilityDeclarations).toContain('calculateOwnablePackageCid');

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const utilities = await import('@ownables/core/utils'); process.stdout.write(JSON.stringify(Object.keys(utilities).sort()));",
      ],
      { cwd: PACKAGE_ROOT }
    );

    expect(JSON.parse(stdout)).toEqual(['calculateOwnablePackageCid']);
  }, 15000);
});
