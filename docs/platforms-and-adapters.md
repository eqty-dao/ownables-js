# Platform and adapter quickstart

This guide covers package-level usage for browser, node, and EVM adapter packages.

## Browser package (`@ownables/platform-browser`)

Main exports:

- `IDBService`
- `LocalStorageService`
- `SessionStorageService`
- `PackageService`
- `RelayService` (legacy/deprecated)
- `BrowserRuntimeSourceProvider`
- `BrowserRuntimeRpcProvider`

Typical usage:

```ts
import {
  IDBService,
  LocalStorageService,
  PackageService,
  RelayService,
} from '@ownables/platform-browser';

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
- `NodeRuntimeSourceProvider`
- `NodeRuntimeRpcProvider`

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

## Builder (`@ownables/builder`)

Main export:

- `BuilderService`

`@ownables/builder` replaces obuilder upload-first flows with direct deploy orchestration.

`BuilderService.prepareOwnable(input)` accepts `File[]`, which works in both modern browsers and Node.js (Node 18+). Package, deploy, fetch, and bundle dependencies are constructor-visible.

### Browser flow

1. Build/select asset files (`File[]`).
2. Call `builder.prepareOwnable(...)`.
3. Build instantiate payload with `builder.buildInstantiateMsg(...)`.
4. Load wasm bytes (`Uint8Array`) and call `builder.deploy(...)`.

### Node flow

1. Build/select asset files (`File[]`) in Node.
2. Call `builder.prepareOwnable(...)`.
3. Build instantiate payload with `builder.buildInstantiateMsg(...)`.
4. Read wasm bytes (`Uint8Array`) from disk/object storage and call `builder.deploy(...)`.

### WASM source in browser

You must provide `wasm: Uint8Array` to `builder.deploy(...)`.

Use app-local/static assets that are versioned with your app build.

Common patterns:

- `public/ownable_bg.wasm` + `fetch(...)`
- bundler-managed asset in `src/assets` (or equivalent), loaded via emitted asset URL
- `@ownables/builder/ownable_bg.wasm?url` (Vite-style package asset URL import)

React example (`public/`):

```ts
async function loadWasmFromPublic(): Promise<Uint8Array> {
  const res = await fetch('/ownable_bg.wasm');
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

React example (`src/assets`):

```ts
import ownableWasmUrl from './assets/ownable_bg.wasm?url';

async function loadWasmFromAssetUrl(): Promise<Uint8Array> {
  const res = await fetch(ownableWasmUrl);
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

React example (Vite package asset import):

```ts
import ownableWasmUrl from '@ownables/builder/ownable_bg.wasm?url';

async function loadWasmFromBuilderPackage(): Promise<Uint8Array> {
  const res = await fetch(ownableWasmUrl);
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

## Builder client (`@ownables/builder-client`, deprecated)

Main export:

- `BuilderService`

This package remains for temporary compatibility. New integrations should migrate to `@ownables/builder`.

## Integration direction

- New integrations should prefer Hub-backed discovery and import flows for delivery signaling.
- Keep Relay support only for compatibility/migration windows.
