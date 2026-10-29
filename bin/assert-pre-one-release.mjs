import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packagePaths = [
  'packages/core/package.json',
  'packages/adapter-ethers/package.json',
  'packages/adapter-viem/package.json',
  'packages/builder/package.json',
  'packages/builder-client/package.json',
  'packages/platform-browser/package.json',
  'packages/platform-node/package.json',
  'packages/platform-react-native/package.json',
];

const packages = packagePaths.map((packagePath) => {
  const contents = readFileSync(resolve(packagePath), 'utf8');
  return { packagePath, ...JSON.parse(contents) };
});

const preOnePackages = packages.filter(({ version }) => /^0\./.test(version));
if (preOnePackages.length === 0) {
  console.log(
    'Skipping the pre-1.0 release guard because every public package has major version one or higher.'
  );
  process.exit(0);
}

if (preOnePackages.length !== packages.length) {
  throw new Error(
    'Public package major versions must be consistent before publishing a coordinated release.'
  );
}

const latestTag = execFileSync('git', ['describe', '--tags', '--match', 'v0.*', '--abbrev=0'], {
  encoding: 'utf8',
}).trim();
const commits = execFileSync('git', ['log', '--format=%B%x00', `${latestTag}..HEAD`], {
  encoding: 'utf8',
});

const hasBreakingHeader = commits
  .split('\0')
  .some((message) => /^[a-z]+(?:\([^\n)]*\))?!:/m.test(message));
const hasBreakingFooter = /^BREAKING CHANGES?:/m.test(commits);

if (hasBreakingHeader || hasBreakingFooter) {
  throw new Error(
    `Refusing to publish a pre-1.0 release: commits since ${latestTag} use an explicit breaking-change marker. ` +
      'Use ordinary feat: commits while the public packages remain at 0.x, or make an explicit reviewed 1.0.0 change.'
  );
}

console.log(`Pre-1.0 release guard passed since ${latestTag}.`);
