# ownables-js

TypeScript libraries for integrating Ownables in applications.

Use these packages to validate, execute, and interact with Ownables in both browser and Node.js environments.

## What you can build

- Ownables-aware apps that read and execute Ownable state.
- Browser integrations with storage, package loading, and Relay (legacy) support.
- Node integrations with sandboxed execution and persistent state stores.
- EVM integrations through viem- or ethers-based adapters.

## Packages

- `@ownables/core`: core Ownables domain logic and shared interfaces.
- `@ownables/platform-browser`: browser adapters and services.
- `@ownables/platform-node`: node adapters (sandbox RPC, state store, package IO).
- `@ownables/adapter-viem`: viem/EVM adapter services.
- `@ownables/adapter-ethers`: ethers/EVM adapter services.
- `@ownables/builder`: ownable build/deploy orchestration for browser and Node.
- `@ownables/builder-client`: deprecated obuilder API client (compatibility only).
- `@ownables/notify-core`: shared Ownables notification types, validation, and message building.
- `@ownables/notify-client`: DI services for notification subscribe/inbox/accept flows.
- `@ownables/notify-publisher`: DI service for publishing Ownables notification events.

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

## Temporary docs

- Docs index and scope: [docs/temporary-docs.md](./docs/temporary-docs.md)
- Core runtime quickstart: [docs/core-runtime-quickstart.md](./docs/core-runtime-quickstart.md)
- Platform and adapter quickstart: [docs/platforms-and-adapters.md](./docs/platforms-and-adapters.md)
- Notify integration guide: [docs/notify-integration.md](./docs/notify-integration.md)

## Monorepo layout

```text
packages/
  core/
  platform-browser/
  platform-node/
  adapter-viem/
  adapter-ethers/
  builder/
  builder-client/
  notify-core/
  notify-client/
  notify-publisher/
```

## Release

Releases are automated with semantic-release via GitHub Actions (`.github/workflows/publish.yml`).

## License

MIT — see [LICENSE](./LICENSE).
