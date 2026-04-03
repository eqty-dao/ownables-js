# @ownables/platform-browser

Browser adapters and services for Ownables package loading and storage.

## Install

```bash
yarn add @ownables/platform-browser
```

## Main exports

- `IDBService`
- `LocalStorageService`
- `SessionStorageService`
- `PackageService`
- `RelayService` (legacy/deprecated)
- `calculateCid`

## Quick start

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

## Development

```bash
yarn workspace @ownables/platform-browser run build
yarn workspace @ownables/platform-browser run typecheck
```

