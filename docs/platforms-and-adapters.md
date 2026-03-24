# Platform and adapter quickstart

This guide covers package-level usage for browser, node, and EVM adapter packages.

## Browser package (`@ownables/platform-browser`)

Main exports:

- `IDBService`
- `LocalStorageService`
- `SessionStorageService`
- `PackageService`
- `RelayService` (legacy/deprecated)
- `calculateCid`

Typical usage:

```ts
import {
  IDBService,
  LocalStorageService,
  PackageService,
  RelayService,
} from "@ownables/platform-browser";

const idb = new IDBService();
const storage = new LocalStorageService();
const relay = new RelayService(anchorProvider);
const packages = new PackageService(idb, relay, storage);
```

## Node package (`@ownables/platform-node`)

Main exports:

- `BucketStateStore`
- `NodeSandboxOwnableRPC`
- `NodePackageAssetIO`

`NodePackageAssetIO` expects resolvers/loaders via `NodePackageAssetIOOptions`.

`BucketStateStore` expects a `BucketLike` implementation (`list/get/put/delete`) and adapts it to the core `StateStore` interface.

## EVM adapters (`@ownables/adapter-viem`, `@ownables/adapter-ethers`)

Main exports from both:

- `EQTYService`
- `MockEQTYService`
- `EQTY` types

Use:

- `EQTYService` with real chain/provider integrations.
- `MockEQTYService` for tests/dev flows that do not require chain calls.

## Browser builder (`@ownables/builder`)

Main export:

- `prepareOwnable(input)`
- `buildInstantiateMsg(input, packageCid, networkId, nft?)`
- `deploy(adapter, params)`
- `estimateCost(...)`

`@ownables/builder` replaces obuilder upload-first flows with browser-first packaging + direct deploy orchestration.

## Builder client (`@ownables/builder-client`, deprecated)

Main export:

- `BuilderService`

This package remains for temporary compatibility. New integrations should migrate to `@ownables/builder`.

## Integration direction

- New integrations should prefer hub + notify flows for delivery signaling.
- Keep Relay support only for compatibility/migration windows.
