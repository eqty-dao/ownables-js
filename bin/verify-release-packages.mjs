import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!/^0\.13\.0$/.test(version ?? '')) {
  throw new Error('Usage: node bin/verify-release-packages.mjs 0.13.0');
}

const packages = [
  'core',
  'adapter-ethers',
  'adapter-viem',
  'builder',
  'builder-client',
  'platform-browser',
  'platform-node',
  'platform-react-native'
];

for (const packageName of packages) {
  const packageDir = resolve('packages', packageName);
  const sourceManifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));

  if (sourceManifest.version !== version) {
    throw new Error(`${sourceManifest.name} is ${sourceManifest.version}, expected ${version}.`);
  }

  if (packageName !== 'core' && sourceManifest.dependencies?.['@ownables/core'] !== version) {
    throw new Error(`${sourceManifest.name} must depend on @ownables/core@${version}.`);
  }

  const packResult = JSON.parse(
    execFileSync('npm', ['pack', '--json'], { cwd: packageDir, encoding: 'utf8' })
  );
  const tarball = resolve(packageDir, packResult[0].filename);

  try {
    const packedManifest = JSON.parse(
      execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })
    );
    const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    const hasWorkspaceDependency = dependencyGroups.some((group) =>
      Object.values(packedManifest[group] ?? {}).some(
        (dependency) => typeof dependency === 'string' && dependency.startsWith('workspace:')
      )
    );

    if (packedManifest.version !== version) {
      throw new Error(`${packedManifest.name} packed as ${packedManifest.version}, expected ${version}.`);
    }
    if (hasWorkspaceDependency) {
      throw new Error(`${packedManifest.name} contains a workspace: dependency in its tarball.`);
    }
    if (packageName !== 'core' && packedManifest.dependencies?.['@ownables/core'] !== version) {
      throw new Error(`${packedManifest.name} must pack @ownables/core@${version}.`);
    }
  } finally {
    if (existsSync(tarball)) {
      rmSync(tarball);
    }
  }
}

console.log(`Verified packed manifests for all public packages at ${version}.`);
