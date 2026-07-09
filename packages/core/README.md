# @ownables/core

Core Ownables domain types and runtime services.

## Install

```bash
yarn add @ownables/core
```

## Main exports

- Interfaces: `AnchorProvider`, `StateStore`, `PackageAssetIO`, `RuntimeSourceProvider`
- Services: `EventChainService`, `OwnableService`, `WorkerRPC`, `StateStoreRecordStore`, `PollingService` (legacy)
- Services: `calculateOwnablePackageCid`, replay helpers (`publicEventReplayKey`, `dedupeIndexedPublicEvents`, `evaluateReplayFreshness`)
- Types: `TypedPackage`, `TypedOwnableInfo`, `OwnableRuntime`, `MessageInfo`, `SIWE`, `Authority`, `Replay`, and related runtime types

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
- Anchor providers may accept optional anchor tx options on `submitAnchors()`, including EVM `value`.
- Dynamic ownables using `ownable-std` v0.8 are expected to expose the split runtime ABI: `register`, `ingest`, and `encode_public_event`.
- `OwnableService.consume()` replays cross-ownable semantic events through `ingest()`.
- `OwnableService.emitPublicEvent()` encodes the ownable-defined payload, submits `emitPublicEvent()` on Anchor, validates the canonical `subjectId`, and returns the emitted public-event observation without replaying local state.
- `OwnableService.replayPublicEvent()` and `OwnableService.replayIndexedPublicEvents()` are the explicit replay/input surfaces for applying already-emitted or indexed public events.
- `PollingService`/Relay flows are still available but legacy.

## Development

```bash
yarn workspace @ownables/core run build
yarn workspace @ownables/core run typecheck
```
