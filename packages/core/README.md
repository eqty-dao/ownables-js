# @ownables/core

Core Ownables domain types and runtime services.

## Install

```bash
yarn add @ownables/core
```

## Main exports

- Interfaces: `AnchorProvider`, `StateStore`, `PackageAssetIO`, `RuntimeSourceProvider`, `RuntimeRPCProvider`
- Services: `AnchorValidationService`, `EventChainService`, `OwnableService`, `ProgressService`, `PublicEventReplayService`, `ReplayAuthorityService`, `WorkerRPC`, `StateStoreRecordStore`, `PollingService` (legacy)
- Utility: `calculateOwnablePackageCid` and `OwnablePackageCidEntry`, available exclusively from `@ownables/core/utils`
- Types: `TypedPackage`, `TypedOwnableInfo`, `OwnableRuntime`, `MessageInfo`, `SIWE`, `Authority`, `Replay`, and related runtime types

## Quick start

```ts
import {
  EventChainService,
  AnchorValidationService,
  OwnableService,
  PublicEventReplayService,
  type AnchorProvider,
  type StateStore,
  type PackageAssetIO,
  type RuntimeSourceProvider,
  type RuntimeRPCProvider,
} from "@ownables/core";

const stateStore: StateStore = /* your implementation */;
const anchorProvider: AnchorProvider = /* your implementation */;
const packageAssetIO: PackageAssetIO = /* your implementation */;
const runtimeSource: RuntimeSourceProvider = /* your platform provider */;
const runtimeRpc: RuntimeRPCProvider = /* your platform provider */;

const anchorValidation = new AnchorValidationService(anchorProvider);
const replay = new PublicEventReplayService();
const chains = new EventChainService(stateStore, anchorProvider, anchorValidation);
const ownables = new OwnableService({
  stateStore,
  eventChains: chains,
  anchorProvider,
  packages: packageAssetIO,
  runtimeSource,
  runtimeRpc,
  replay,
});
```

## Notes

- `PackageAssetIO` is responsible for loading package assets such as `ownable_bg.wasm`.
- Anchor providers may accept optional anchor tx options on `submitAnchors()`, including EVM `value`.
- Dynamic ownables using `ownable-std` v0.8 are expected to expose the split runtime ABI: `register`, `ingest`, and `encode_public_event`.
- `OwnableService.consume()` replays cross-ownable semantic events through `ingest()`.
- `OwnableService.emitPublicEvent()` encodes the ownable-defined payload, submits `emitPublicEvent()` on Anchor, then immediately replays the canonical on-chain event locally through `register()`.
- `PollingService`/Relay flows are still available but legacy.

## Development

```bash
yarn workspace @ownables/core run build
yarn workspace @ownables/core run typecheck
```
