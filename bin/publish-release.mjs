import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { assertReleaseVersion, publicPackageNames } from './release-artifacts.mjs';

const version = process.argv[2];
assertReleaseVersion(version);
const artifactDirectory = resolve(process.argv[3] ?? join('release-artifacts', version));
const manifestPath = join(artifactDirectory, 'manifest.json');
if (!existsSync(manifestPath)) {
  throw new Error(`Missing release artifact manifest: ${manifestPath}`);
}

const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const [major, minor, patch] = npmVersion.split('.').map(Number);
if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
  throw new Error(`npm ${npmVersion} cannot use trusted publishing. npm >= 11.5.1 is required.`);
}

const registry = 'https://registry.npmjs.org';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (
  manifest.schemaVersion !== 1 ||
  manifest.version !== version ||
  !Array.isArray(manifest.packages)
) {
  throw new Error(`Invalid release artifact manifest: ${manifestPath}`);
}

const byName = new Map(manifest.packages.map((item) => [item.name, item]));
if (byName.size !== publicPackageNames.length) {
  throw new Error('Release artifact manifest has duplicate packages.');
}
const packages = publicPackageNames.map((packageName) => {
  const name = `@ownables/${packageName}`;
  const item = byName.get(name);
  if (!item || item.version !== version || typeof item.tarball !== 'string') {
    throw new Error(`Release artifact manifest is missing ${name}@${version}.`);
  }
  const tarball = resolve(artifactDirectory, item.tarball);
  if (!tarball.startsWith(`${artifactDirectory}/`) || !existsSync(tarball)) {
    throw new Error(`Release archive is missing for ${name}.`);
  }
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  if (integrity !== item.integrity) {
    throw new Error(`Release archive integrity mismatch for ${name}.`);
  }
  return { ...item, name, tarball };
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function registryVersion(name) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Cannot read ${name}@${version}: registry returned ${response.status}.`);
  }
  const entry = await response.json();
  if (entry.name !== name || entry.version !== version || typeof entry.dist?.tarball !== 'string') {
    throw new Error(`Registry returned an unexpected version for ${name}@${version}.`);
  }
  return entry;
}

async function assertRegistryArchive(item) {
  const entry = await registryVersion(item.name);
  if (!entry) return false;
  if (entry.dist.integrity !== item.integrity) {
    throw new Error(`Registry integrity mismatch for ${item.name}@${version}.`);
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const archive = await fetch(entry.dist.tarball, { signal: AbortSignal.timeout(60_000) });
    if (archive.status === 404 || archive.status === 503) {
      await wait(5_000);
      continue;
    }
    if (!archive.ok) {
      throw new Error(`Cannot download ${item.name}@${version} from npm: ${archive.status}.`);
    }
    const bytes = Buffer.from(await archive.arrayBuffer());
    const downloadedIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (downloadedIntegrity !== item.integrity) {
      throw new Error(`Downloaded registry archive mismatch for ${item.name}@${version}.`);
    }
    return { integrity: entry.dist.integrity, tarball: entry.dist.tarball };
  }
  throw new Error(`Registry archive for ${item.name}@${version} did not become available.`);
}

for (const item of packages) {
  await assertRegistryArchive(item);
}

for (const item of packages) {
  if (await assertRegistryArchive(item)) {
    console.log(`Already verified: ${item.name}@${version}`);
    continue;
  }
  console.log(`Publishing inspected archive: ${item.name}@${version}`);
  const result = spawnSync(
    'npm',
    [
      'publish',
      item.tarball,
      '--access',
      'public',
      '--provenance',
      '--tag=latest',
      `--registry=${registry}`,
    ],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm publish failed for ${item.name}@${version}.`);
  }

  let verified = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await assertRegistryArchive(item)) {
      verified = true;
      break;
    }
    await wait(5_000);
  }
  if (!verified) {
    throw new Error(`${item.name}@${version} is not visible with matching integrity.`);
  }
}

const registryArchives = {};
for (const item of packages) {
  const archive = await assertRegistryArchive(item);
  if (!archive) throw new Error(`${item.name}@${version} disappeared from npm.`);
  registryArchives[item.name] = archive;
}
writeFileSync(
  manifestPath,
  `${JSON.stringify({ ...manifest, registry: registryArchives }, null, 2)}\n`
);

console.log(
  `Published and verified exact registry archives for all public packages at ${version}.`
);
