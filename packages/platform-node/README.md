# @ownables/platform-node

Node.js adapters for Ownables runtime, package assets, archive, and state persistence.

## Install

```bash
yarn add @ownables/platform-node
```

## Main exports

- `BucketStateStore`
- `BucketArchiveService`
- `NodeSandboxOwnableRPC`
- `NodePackageAssetIO`
- `PlatformNode` types

## Notes

- `NodePackageAssetIO` expects resolvers/loaders via `NodePackageAssetIOOptions`.
- `BucketStateStore` expects a `BucketLike` implementation (`list/get/put/delete`).

## Development

```bash
yarn workspace @ownables/platform-node run build
yarn workspace @ownables/platform-node run typecheck
```

