import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertReleaseVersion, inspectTarball, publicPackageNames } from './release-artifacts.mjs';

const version = process.argv[2];
assertReleaseVersion(version);
const artifactDirectory = resolve(process.argv[3] ?? join('release-artifacts', version));
const manifestPath = join(artifactDirectory, 'manifest.json');
if (!existsSync(manifestPath)) {
  throw new Error(`Missing release artifact manifest: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (
  manifest.schemaVersion !== 1 ||
  manifest.version !== version ||
  !Array.isArray(manifest.packages)
) {
  throw new Error(`Invalid release artifact manifest: ${manifestPath}`);
}
if (manifest.packages.length !== publicPackageNames.length) {
  throw new Error(`Expected ${publicPackageNames.length} release archives.`);
}

const expectedNames = new Set(publicPackageNames.map((name) => `@ownables/${name}`));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'ownables-release-verification-'));
try {
  for (const item of manifest.packages) {
    if (
      !expectedNames.delete(item.name) ||
      item.version !== version ||
      typeof item.tarball !== 'string'
    ) {
      throw new Error(`Unexpected package in release manifest: ${item.name}@${item.version}`);
    }
    const packageName = item.name.slice('@ownables/'.length);
    const tarball = resolve(artifactDirectory, item.tarball);
    if (!tarball.startsWith(`${artifactDirectory}/`) || !existsSync(tarball)) {
      throw new Error(`Missing release archive for ${item.name}.`);
    }
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (integrity !== item.integrity) {
      throw new Error(`Release archive integrity mismatch for ${item.name}.`);
    }
    const inspection = inspectTarball(tarball, packageName, version, temporaryRoot);
    if (
      JSON.stringify(inspection) !== JSON.stringify({ files: item.files, builder: item.builder })
    ) {
      throw new Error(`Release archive inventory mismatch for ${item.name}.`);
    }
  }
  if (expectedNames.size > 0) {
    throw new Error(`Release manifest is missing: ${[...expectedNames].join(', ')}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(`Verified exact release archives for all public packages at ${version}.`);
