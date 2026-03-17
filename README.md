# ownables-js

Shared Ownables JavaScript libraries extracted from the SDK into a Yarn v4 monorepo.

## Packages

- `@ownables/core`: domain services, shared interfaces, and orchestration logic.
- `@ownables/platform-browser`: browser-specific adapters and services (storage, relay wiring, package IO).
- `@ownables/adapter-viem`: viem/EVM adapters and services.
- `@ownables/builder-client`: client for Ownables builder upload APIs.

## Requirements

- Node.js 22+
- Corepack enabled (`corepack enable`)

## Install

```bash
yarn install
```

## Scripts

- `yarn test`: run all tests.
- `yarn test packages/core/tests`: run tests for a specific package path.
- `yarn lint`: run ESLint.
- `yarn typecheck`: run TypeScript checks in all workspaces.
- `yarn build`: build all workspaces.
- `yarn format`: run Prettier write.

## Workspace Layout

```text
packages/
  core/
  platform-browser/
  adapter-viem/
  builder-client/
```

## CI

GitHub Actions workflow:

- `.github/workflows/unit-tests.yml`

Runs matrix unit tests per package using `yarn test` with path filters.

## License

MIT. See [LICENSE](./LICENSE).
