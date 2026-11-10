import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertNoGeneratedArtifacts,
  assertPackManifest,
  exactPackResult,
} from './release-artifacts.mjs';

const temporaryRoots = [];

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ownables-release-artifacts-test-'));
  mkdirSync(join(root, 'ownables'), { recursive: true });
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('release artifacts', () => {
  it('accepts the exact npm 11 and npm 12 pack result shapes', () => {
    const packed = {
      name: '@ownables/core',
      version: '0.14.0',
      filename: 'ownables-core-0.14.0.tgz',
    };
    expect(exactPackResult([packed], 'core', '0.14.0')).toBe(packed);
    expect(exactPackResult({ '@ownables/core': packed }, 'core', '0.14.0')).toBe(packed);
    expect(() => exactPackResult([packed, packed], 'core', '0.14.0')).toThrow();
  });

  it('rejects stale generated output before the release build', () => {
    const root = createRoot();
    const staleFile = join(root, 'packages', 'core', 'dist', 'StateStoreRecordStore.js');
    mkdirSync(join(staleFile, '..'), { recursive: true });
    writeFileSync(staleFile, 'stale');

    expect(() => assertNoGeneratedArtifacts(root)).toThrow('packages/core/dist');
  });

  it('rejects a packed workspace dependency', () => {
    expect(() =>
      assertPackManifest(
        {
          name: '@ownables/core',
          version: '0.14.1',
          dependencies: { 'another-package': 'workspace:*' },
        },
        'core',
        '0.14.1'
      )
    ).toThrow('workspace: dependency');
  });
});
