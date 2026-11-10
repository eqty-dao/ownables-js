import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export const publicPackageNames = [
  'core',
  'adapter-ethers',
  'adapter-viem',
  'builder',
  'builder-client',
  'platform-browser',
  'platform-node',
  'platform-react-native',
];

const coreConsumers = new Set([
  'adapter-ethers',
  'adapter-viem',
  'builder',
  'platform-browser',
  'platform-node',
  'platform-react-native',
]);

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');

export function assertReleaseVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    throw new Error('Usage: node bin/release-artifacts.mjs <release-version> [--verify-twice]');
  }
}

export function exactPackResult(result, packageName, version) {
  const name = `@ownables/${packageName}`;
  const entries = Array.isArray(result) ? result : Object.values(result ?? {});
  if (
    entries.length !== 1 ||
    entries[0]?.name !== name ||
    entries[0]?.version !== version ||
    typeof entries[0]?.filename !== 'string'
  ) {
    throw new Error(`Unexpected npm pack result for ${name}@${version}.`);
  }
  return entries[0];
}

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runVisible(command, args, cwd, options = {}) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    ...options,
  });
}

function sha512(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`Unsupported archive entry type: ${path}`);
    }
  }
  return files.sort();
}

export function generatedArtifactPaths(root) {
  const paths = [];
  for (const packageName of publicPackageNames) {
    const packageRoot = join(root, 'packages', packageName);
    for (const name of ['dist', 'dossier.zip', 'ownable_bg.wasm']) {
      const path = join(packageRoot, name);
      if (existsSync(path)) paths.push(relative(root, path));
    }
  }

  const ownablesRoot = join(root, 'ownables');
  for (const name of ['target']) {
    const path = join(ownablesRoot, name);
    if (existsSync(path)) paths.push(relative(root, path));
  }
  for (const entry of readdirSync(ownablesRoot, { withFileTypes: true })) {
    const path = join(ownablesRoot, entry.name);
    if (entry.isFile() && entry.name.endsWith('.zip')) paths.push(relative(root, path));
    if (!entry.isDirectory()) continue;
    for (const name of ['pkg', 'schema', 'target']) {
      const generatedPath = join(path, name);
      if (existsSync(generatedPath)) paths.push(relative(root, generatedPath));
    }
  }
  return paths.sort();
}

export function assertNoGeneratedArtifacts(root) {
  const paths = generatedArtifactPaths(root);
  if (paths.length > 0) {
    throw new Error(
      `Release tree contains generated artifacts before the build: ${paths.join(', ')}`
    );
  }
}

function collectEntrypoints(value) {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectEntrypoints);
}

function normalizeTarballPath(path) {
  return path.replace(/^\.\//, '');
}

function hasPackedEntrypoint(packedFiles, entrypoint) {
  const normalizedEntrypoint = normalizeTarballPath(entrypoint);
  if (!normalizedEntrypoint.includes('*')) return packedFiles.has(normalizedEntrypoint);
  const pattern = normalizedEntrypoint
    .split('*')
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('[^/]*');
  return [...packedFiles].some((packedFile) => new RegExp(`^${pattern}$`).test(packedFile));
}

export function assertPackManifest(manifest, packageName, version) {
  if (manifest.name !== `@ownables/${packageName}` || manifest.version !== version) {
    throw new Error(`Unexpected packed manifest: ${manifest.name}@${manifest.version}`);
  }
  const dependencyGroups = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ];
  if (
    dependencyGroups.some((group) =>
      Object.values(manifest[group] ?? {}).some(
        (dependency) => typeof dependency === 'string' && dependency.startsWith('workspace:')
      )
    )
  ) {
    throw new Error(`${manifest.name} contains a workspace: dependency.`);
  }
  if (coreConsumers.has(packageName) && manifest.dependencies?.['@ownables/core'] !== version) {
    throw new Error(`${manifest.name} must depend on @ownables/core@${version}.`);
  }
}

export function inspectTarball(tarball, packageName, version, temporaryRoot) {
  const extracted = mkdtempSync(join(temporaryRoot, 'extract-'));
  try {
    runVisible('tar', ['-xzf', tarball, '-C', extracted], repositoryRoot);
    const packageRoot = join(extracted, 'package');
    const files = walkFiles(packageRoot).map((path) => ({
      path: relative(packageRoot, path),
      mode: statSync(path).mode & 0o777,
      sha512: sha512(path),
    }));
    const packedManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assertPackManifest(packedManifest, packageName, version);

    const packedFiles = new Set(files.map((file) => file.path));
    const entrypoints = [
      packedManifest.main,
      packedManifest.types,
      ...collectEntrypoints(packedManifest.exports),
    ].filter((entrypoint) => typeof entrypoint === 'string');
    const missingEntrypoint = entrypoints.find(
      (entrypoint) => !hasPackedEntrypoint(packedFiles, entrypoint)
    );
    if (missingEntrypoint) {
      throw new Error(`${packedManifest.name} is missing packed entrypoint ${missingEntrypoint}.`);
    }

    const details = { files };
    if (packageName === 'builder') {
      const wasm = join(packageRoot, 'ownable_bg.wasm');
      const dossier = join(packageRoot, 'dossier.zip');
      if (!existsSync(wasm) || !existsSync(dossier)) {
        throw new Error('@ownables/builder is missing a required contract artifact.');
      }
      const dossierEntries = run('unzip', ['-Z1', dossier], repositoryRoot)
        .split('\n')
        .filter(Boolean)
        .sort()
        .map((name) => ({
          path: name,
          sha512: `sha512-${createHash('sha512')
            .update(execFileSync('unzip', ['-p', dossier, name]))
            .digest('base64')}`,
        }));
      details.builder = {
        wasmSha512: sha512(wasm),
        dossierZipSha512: sha512(dossier),
        dossierEntries,
      };
    }
    return details;
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

function assertExactSource(root, version) {
  for (const packageName of publicPackageNames) {
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages', packageName, 'package.json'), 'utf8')
    );
    assertPackManifest(manifest, packageName, version);
  }
}

function assertCleanGitSource(root) {
  run('git', ['diff', '--quiet'], root);
  run('git', ['diff', '--cached', '--quiet'], root);
}

function materializeReleaseTree(root, temporaryRoot) {
  const tree = join(temporaryRoot, 'source');
  runVisible('git', ['worktree', 'add', '--detach', tree, 'HEAD'], root);
  return tree;
}

function removeReleaseTree(root, tree) {
  try {
    runVisible('git', ['worktree', 'remove', '--force', tree], root);
  } catch {
    // Preserve the original failure if git worktree cleanup fails.
  }
}

function buildAndPack(root, version, outputDirectory) {
  if (existsSync(outputDirectory)) {
    throw new Error(`Refusing to overwrite existing release artifacts: ${outputDirectory}`);
  }
  mkdirSync(outputDirectory, { recursive: true });
  const tarballDirectory = join(outputDirectory, 'tarballs');
  mkdirSync(tarballDirectory);
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ownables-release-artifacts-'));
  let sourceTree;
  try {
    assertCleanGitSource(root);
    sourceTree = materializeReleaseTree(root, temporaryRoot);
    assertExactSource(sourceTree, version);
    runVisible('corepack', ['yarn', 'install', '--immutable'], sourceTree);
    assertNoGeneratedArtifacts(sourceTree);
    const rustFlags = [
      process.env.RUSTFLAGS,
      `--remap-path-prefix=${temporaryRoot}=/build`,
      `--remap-path-prefix=${realpathSync(temporaryRoot)}=/build`,
    ]
      .filter(Boolean)
      .join(' ');
    runVisible('corepack', ['yarn', 'build:packages'], sourceTree, {
      env: {
        ...process.env,
        CARGO_HOME: join(temporaryRoot, 'cargo-home'),
        RUSTFLAGS: rustFlags,
      },
    });

    const sourceCommit = run('git', ['rev-parse', 'HEAD'], sourceTree).trim();
    const packages = [];
    for (const packageName of publicPackageNames) {
      const packageDirectory = join(sourceTree, 'packages', packageName);
      const result = JSON.parse(
        run(
          'npm',
          ['pack', '--json', '--ignore-scripts', `--pack-destination=${tarballDirectory}`],
          packageDirectory
        )
      );
      const packed = exactPackResult(result, packageName, version);
      const tarball = join(tarballDirectory, packed.filename);
      if (!existsSync(tarball)) throw new Error(`npm pack did not create ${tarball}.`);
      const inspection = inspectTarball(tarball, packageName, version, temporaryRoot);
      packages.push({
        name: `@ownables/${packageName}`,
        version,
        tarball: join('tarballs', packed.filename),
        integrity: sha512(tarball),
        ...inspection,
      });
    }

    const manifest = {
      schemaVersion: 1,
      sourceCommit,
      version,
      packages,
    };
    writeFileSync(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    if (sourceTree) removeReleaseTree(root, sourceTree);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function comparableManifest(manifest) {
  return JSON.stringify({ version: manifest.version, packages: manifest.packages });
}

function parseArguments(argv) {
  const [version, ...options] = argv;
  assertReleaseVersion(version);
  const verifyTwice = options.includes('--verify-twice');
  const unexpected = options.filter((option) => option !== '--verify-twice');
  if (unexpected.length > 0) {
    throw new Error(`Unknown option: ${unexpected.join(', ')}`);
  }
  return { version, verifyTwice };
}

export function createReleaseArtifacts(version, { root = repositoryRoot, outputDirectory } = {}) {
  assertReleaseVersion(version);
  const output = outputDirectory ?? join(root, 'release-artifacts', version);
  return buildAndPack(root, version, output);
}

function main() {
  const { version, verifyTwice } = parseArguments(process.argv.slice(2));
  const output = join(repositoryRoot, 'release-artifacts', version);
  const manifest = createReleaseArtifacts(version, { outputDirectory: output });
  if (!verifyTwice) {
    console.log(`Created inspected release artifacts at ${output}.`);
    return;
  }

  const secondRoot = mkdtempSync(join(tmpdir(), 'ownables-release-reproducibility-'));
  try {
    const secondManifest = createReleaseArtifacts(version, {
      outputDirectory: join(secondRoot, 'artifacts'),
    });
    if (comparableManifest(manifest) !== comparableManifest(secondManifest)) {
      throw new Error('Two clean release builds produced different package artifact manifests.');
    }
    console.log(`Verified reproducible release artifacts at ${output}.`);
  } finally {
    rmSync(secondRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === scriptPath) main();
