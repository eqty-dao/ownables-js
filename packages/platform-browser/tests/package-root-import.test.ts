import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import type {
  HubAvailableUploadResult,
  HubPendingUploadResult,
  HubUploadResult,
} from '@ownables/platform-browser';

type Assert<T extends true> = T;
type IsAssignable<T, U> = T extends U ? true : false;

type _AvailableHasCid = Assert<IsAssignable<HubAvailableUploadResult['cid'], string>>;
type _PendingHasExpiry = Assert<IsAssignable<HubPendingUploadResult['expiresAt'], string>>;
type _UploadIncludesBothVariants = Assert<
  IsAssignable<HubAvailableUploadResult, HubUploadResult> &
    IsAssignable<HubPendingUploadResult, HubUploadResult>
>;

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILT_INDEX_PATH = `${PACKAGE_ROOT}/${packageJson.main}`;
const BUILT_TYPES_PATH = `${PACKAGE_ROOT}/${packageJson.types}`;

describe('@ownables/platform-browser package root', () => {
  it('resolves and imports from the built package root entry', async () => {
    await execFileAsync('yarn', ['workspace', '@ownables/platform-browser', 'build'], {
      cwd: REPO_ROOT,
    });

    await access(BUILT_INDEX_PATH);
    await access(BUILT_TYPES_PATH);

    const builtModule = await import(pathToFileURL(BUILT_INDEX_PATH).href);

    expect(builtModule.PackageService).toBeTypeOf('function');
    expect(builtModule.IDBService).toBeTypeOf('function');
    expect(builtModule.HubService).toBeTypeOf('function');
    expect(builtModule.BrowserRuntimeSourceProvider).toBeTypeOf('function');
    expect(builtModule.BrowserRuntimeRpcProvider).toBeTypeOf('function');
    expect(builtModule.calculateCid).toBeUndefined();
  }, 15000);
});
