# @ownables/core

Core Ownables domain types and runtime services.

## Install

```bash
yarn add @ownables/core
```

## Main exports

- Interfaces: `AnchorProvider`, `StateStore`, `PackageAssetIO`, `RuntimeSourceProvider`
- Services: `EventChainService`, `OwnableService`, `WorkerRPC`, `StateStoreRecordStore`, `PollingService` (legacy)
- Types: `TypedPackage`, `TypedOwnableInfo`, `OwnableRuntime`, `MessageInfo`, `SIWE`, `Authority`, and related runtime types

## Quick start

```ts
import {
  EventChainService,
  OwnableService,
  type AnchorProvider,
  type StateStore,
  type PackageAssetIO,
} from "@ownables/core";

const stateStore: StateStore = /* your implementation */;
const anchorProvider: AnchorProvider = /* your implementation */;
const packageAssetIO: PackageAssetIO = /* your implementation */;

const chains = new EventChainService(stateStore, anchorProvider);
const ownables = new OwnableService(stateStore, chains, anchorProvider, packageAssetIO);
```

## Notes

- `PackageAssetIO` is responsible for loading package assets such as `ownable_bg.wasm`.
- `PollingService`/Relay flows are still available but legacy.

## Development

```bash
yarn workspace @ownables/core run build
yarn workspace @ownables/core run typecheck
```

