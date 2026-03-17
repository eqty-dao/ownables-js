# ownables-js

TypeScript libraries for integrating Ownables in applications.

Use these packages to validate, execute, and interact with Ownables in both browser and Node.js environments.

## What you can build

- Ownables-aware apps that read and execute Ownable state.
- Browser integrations with storage, package loading, and relay support.
- Node integrations with sandboxed execution and persistent state stores.
- EVM integrations through viem- or ethers-based adapters.

## Packages

- `@ownables/core`: core Ownables domain logic and shared interfaces.
- `@ownables/platform-browser`: browser adapters and services.
- `@ownables/platform-node`: node adapters (sandbox RPC, state store, package IO).
- `@ownables/adapter-viem`: viem/EVM adapter services.
- `@ownables/adapter-ethers`: ethers/EVM adapter services.
- `@ownables/builder-client`: client for Ownables builder APIs.

## Requirements

- Node.js 22+
- Corepack enabled:

```bash
corepack enable
```

## Install

```bash
yarn install
```

## Development

- `yarn build`: build all workspace packages.
- `yarn typecheck`: run TypeScript checks.
- `yarn lint`: run ESLint.
- `yarn test`: run all tests.
- `yarn test packages/<package>/tests`: run tests for one package.

## Monorepo layout

```text
packages/
  core/
  platform-browser/
  platform-node/
  adapter-viem/
  adapter-ethers/
  builder-client/
```

## Release

Releases are automated with semantic-release via GitHub Actions (`.github/workflows/release.yml`).

## License

MIT — see [LICENSE](./LICENSE).
