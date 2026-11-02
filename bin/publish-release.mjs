import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  throw new Error('Usage: node bin/publish-release.mjs <release-version>');
}

const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const [major, minor, patch] = npmVersion.split('.').map(Number);
if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
  throw new Error(`npm ${npmVersion} cannot use trusted publishing. npm >= 11.5.1 is required.`);
}

const registry = 'https://registry.npmjs.org';
const packageNames = [
  'core',
  'adapter-ethers',
  'adapter-viem',
  'builder',
  'builder-client',
  'platform-browser',
  'platform-node',
  'platform-react-native',
];

const packages = packageNames.map((name) => {
  const directory = resolve('packages', name);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (manifest.name !== `@ownables/${name}` || manifest.version !== version || manifest.private) {
    throw new Error(
      `Unexpected package manifest in ${directory}: ${manifest.name}@${manifest.version}`
    );
  }
  return { directory, name: manifest.name };
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function publishedVersion(name) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Cannot verify ${name}@${version}: registry returned ${response.status}`);
  }
  const manifest = await response.json();
  if (manifest.name !== name || manifest.version !== version) {
    throw new Error(`Registry returned an unexpected version for ${name}@${version}`);
  }
  return true;
}

for (const item of packages) {
  if (await publishedVersion(item.name)) {
    console.log(`Already published: ${item.name}@${version}`);
    continue;
  }

  console.log(`Publishing exact version: ${item.name}@${version}`);
  const result = spawnSync(
    'npm',
    [
      'publish',
      '--access',
      'public',
      '--provenance',
      '--ignore-scripts',
      '--tag=latest',
      `--registry=${registry}`,
    ],
    { cwd: item.directory, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm publish failed for ${item.name}@${version} (${result.status})`);
  }

  let visible = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await publishedVersion(item.name)) {
      visible = true;
      break;
    }
    await wait(5_000);
  }
  if (!visible) {
    throw new Error(`${item.name}@${version} is not visible in the npm registry after publishing.`);
  }
}
