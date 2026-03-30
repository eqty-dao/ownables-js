# Core and runtime quickstart

This guide covers the central pieces from `@ownables/core` you wire in most integrations.

## Main services

- `EventChainService`: persists/retrieves event chains and optional anchoring state.
- `OwnableService`: initializes runtime, applies events, executes and queries Ownables.
- `SIWEClient`: shared SIWE signing/verification request client.
- `PollingService` (legacy): Relay polling helper; deprecated.

## Required interfaces you provide

From `@ownables/core/interfaces/core`:

- `AnchorProvider`: wallet/signer + anchoring methods.
- `StateStore`: persistent key-value store for Ownable chain state.
- `PackageAssetIO`: package metadata + asset loading (`ownable_bg.wasm`, package manifest/schema assets, etc.).
- `RuntimeSourceProvider` (optional): runtime-owned worker source provider.

## Minimal wiring example

```ts
import {
  EventChainService,
  OwnableService,
  type AnchorProvider,
  type StateStore,
  type PackageAssetIO,
} from "@ownables/core";

const stateStore: StateStore = /* your implementation */;
const anchorProvider: AnchorProvider = /* your signer + anchor implementation */;
const packageAssetIO: PackageAssetIO = /* your package loader */;

const chains = new EventChainService(stateStore, anchorProvider);
const ownables = new OwnableService(stateStore, chains, anchorProvider, packageAssetIO);
```

## Typical runtime flow

1. Resolve package info/asset source (`PackageAssetIO`).
2. Create or load an `EventChain`.
3. Initialize runtime with `ownables.init(chain, cid, rpc)`.
4. Execute/query through `ownables.rpc(chain.id)`.
5. Persist state changes via `EventChainService`.

## Notes

- `PollingService` and Relay-based flows are still available but marked deprecated.
- Anchoring behavior is controlled by your `AnchorProvider` + `EventChainService` settings.
