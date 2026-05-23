# @ownables/platform-react-native

React Native adapters for running `@ownables/core` with native runtime execution and mobile persistence.

## Install

```bash
yarn add @ownables/platform-react-native
```

## What this package contains

### Runtime

- `RNOwnableRPC`
- `createRNRuntimeRpcProvider()`
- `createRNRuntimeSourceProvider()`

Use these to connect `OwnableService` to a native runtime module (typically WAMR).

### Core interfaces

- `RNRuntimeBridge`: JS-to-native runtime boundary for instance lifecycle and ABI calls.
- `RNStateStoreBackend`: key/value backend used by `RNStateStore` (SQLite-backed in production).
- `RNPackageFileSystem`: internal filesystem adapter used by `RNPackageAssetIO` so package asset reads are decoupled from any single RN FS library.
- `RNOwnablePersistenceBackend`: persistence backend for ownable metadata, events, state, snapshots, and attachment refs.
- `RNAttachmentBlobStore`: blob storage abstraction for attachment bytes addressed by CID.

### Adapters/services

- `RNStateStore` (`StateStore` adapter)
- `RNPackageAssetIO` (`PackageAssetIO` adapter)
- `RNOwnablePersistence` (event/state/snapshot/attachment persistence service)

## Runtime model

`RNOwnableRPC` delegates ABI calls to your native module through `RNRuntimeBridge`.

Expected ABI call types:

- `instantiate`
- `execute`
- `query`
- `register`
- `ingest`
- `encode_public_event`

Expected payload format:

- request/response payloads are CBOR bytes (`Uint8Array`)
- error handling follows Host ABI envelope semantics (`success/error_code/error_message`)

Native runtime engine recommendation:

- WAMR (or another engine that is ABI-compatible with your ownable runtime)

## Storage model

`RNOwnablePersistence` is designed for:

- SQLite for metadata/index rows
- Filesystem CAS for attachment blobs

`RNStateStore` is also expected to use a SQLite-backed `RNStateStoreBackend` in production. In-memory or simple key/value implementations are suitable for tests only.

Recommended shape:

- event rows store event binary (`Event.toBinary()`)
- attachment refs store only CID and metadata in SQLite
- attachment bytes stored in filesystem CAS (`attachments/<cid>`)
- state stored as KV entries
- snapshots stored as blobs for fast resume

Important: `eqty-core` binary event serialization does not include attachments. Attachments must be rehydrated from CID references.

`RNPackageFileSystem` exists to keep `RNPackageAssetIO` stable while we finalize concrete RN filesystem implementation details (paths, file APIs, and platform differences) behind a single adapter.

## How to use

### 1. Implement `RNRuntimeBridge`

```ts
import type { RNRuntimeBridge } from '@ownables/platform-react-native';

export class NativeWamrBridge implements RNRuntimeBridge {
  async createInstance(id: string): Promise<string> {
    // delegate to native module
    return id;
  }

  async loadWasm(instanceId: string, wasm: Uint8Array): Promise<void> {
    // delegate to native module
  }

  async call(
    instanceId: string,
    type: 'instantiate' | 'execute' | 'query' | 'register' | 'ingest' | 'encode_public_event',
    payload: Uint8Array
  ): Promise<Uint8Array> {
    // delegate to native module
    return new Uint8Array();
  }

  async disposeInstance(instanceId: string): Promise<void> {
    // delegate to native module
  }
}
```

### 2. Wire `OwnableService` runtime provider

```ts
import {
  OwnableService,
  EventChainService,
  type AnchorProvider,
} from '@ownables/core';
import {
  RNStateStore,
  RNPackageAssetIO,
  createRNRuntimeRpcProvider,
  createRNRuntimeSourceProvider,
} from '@ownables/platform-react-native';

const runtimeBridge = new NativeWamrBridge();

const runtimeRpc = createRNRuntimeRpcProvider({ bridge: runtimeBridge });
const runtimeSource = createRNRuntimeSourceProvider();

const stateStore = new RNStateStore({ backend: myStateStoreBackend });
const packages = new RNPackageAssetIO({
  infoResolver: myInfoResolver,
  fileSystem: myPackageFs,
});

const eventChains = new EventChainService(stateStore, myAnchorProvider as AnchorProvider);

const ownables = new OwnableService(
  stateStore,
  eventChains,
  myAnchorProvider,
  packages,
  runtimeSource,
  console,
  runtimeRpc
);
```

### 3. Use `RNOwnablePersistence` for event/state/snapshot/attachment storage

```ts
import RNOwnablePersistence from '@ownables/platform-react-native';

const persistence = new RNOwnablePersistence({
  backend: myOwnablePersistenceBackend,   // implements RNOwnablePersistenceBackend
  attachmentStore: myAttachmentBlobStore, // implements RNAttachmentBlobStore
  cidCalculator: myCidCalculator,
});

await persistence.saveOwnable({
  id: ownableId,
  packageCid,
  stateHex,
  latestHash,
  createdAt: Date.now(),
});

await persistence.saveStateDump(ownableId, stateDump);
await persistence.saveSnapshot(ownableId, eventIndex, blockHash, stateDump);
```

## Architecture decisions

- Production persistence is SQLite + filesystem CAS.
- Event rows are stored as binary events; attachment bytes are stored by CID in filesystem CAS.
- `RNStateStoreBackend` is expected to be backed by SQLite in production.
- `RNPackageFileSystem` is an implementation boundary inside this architecture, not a product-level user choice.
- This package currently provides interfaces and reusable services; concrete RN SQLite/filesystem implementations are the next implementation step.

## Development

```bash
yarn workspace @ownables/platform-react-native typecheck
yarn workspace @ownables/platform-react-native build
yarn vitest run packages/platform-react-native/tests/*.test.ts
```
