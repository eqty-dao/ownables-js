# Builder migration: `@ownables/builder-client` -> `@ownables/builder`

`@ownables/builder-client` (obuilder transport) is deprecated.
Use `@ownables/builder` for package preparation and deployment in browser or Node.

## API mapping

- `getAddress()`
  - Old: fetch obuilder server LTO wallet address.
  - New: not required. Deploy directly via adapter.

- `getTemplateCost(templateId?)`
  - Old: server template cost endpoint.
  - New: `estimateCost(...)` (local/config or chain-derived).

- `upload(zipFile, options?)`
  - Old: multipart upload to obuilder queue.
  - New: `prepareOwnable(...)` + `buildInstantiateMsg(...)` + `deploy(...)`.

## Before

```ts
import { BuilderService } from "@ownables/builder-client";

const builder = new BuilderService(chainId, {
  url: import.meta.env.VITE_OBUILDER,
  secret: import.meta.env.VITE_OBUILDER_API_SECRET_KEY,
});

const { requestId } = await builder.upload(zipBlob, {
  templateId: 1,
  name: "My Ownable",
  sender: address,
});
```

## After

```ts
import {
  buildInstantiateMsg,
  deploy,
  prepareOwnable,
} from "@ownables/builder";

const prepared = await prepareOwnable({
  name: "My Ownable",
  description: "Ownable deployment",
  files,
  packageService,
});

const instantiateMsg = buildInstantiateMsg({
  name: "My Ownable",
  description: "Browser-first ownable",
  packageCid: prepared.packageCid,
  networkId,
});

const result = await deploy(adapter, {
  wasm,
  instantiateMsg,
  expectedCodeHash,
});
```

## Browser wasm loading

`deploy(...)` expects `wasm: Uint8Array`. In browser apps, a common pattern is to serve `ownable_bg.wasm` from `public/` and fetch bytes before deploy.

You can also load wasm from a bundler-managed local asset (`src/assets` or equivalent) using the emitted asset URL.

You can also load wasm directly from the builder package in Vite-style setups:

```ts
import ownableWasmUrl from "@ownables/builder/ownable_bg.wasm?url";

async function loadWasmFromBuilderPackage(): Promise<Uint8Array> {
  const res = await fetch(ownableWasmUrl);
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

React example (`public/`):

```ts
async function loadWasmFromPublic(): Promise<Uint8Array> {
  const res = await fetch("/ownable_bg.wasm");
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

React example (`src/assets`):

```ts
import ownableWasmUrl from "./assets/ownable_bg.wasm?url";

async function loadWasmFromAssetUrl(): Promise<Uint8Array> {
  const res = await fetch(ownableWasmUrl);
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

## Compatibility window

`@ownables/builder-client` remains available for one release cycle as a compatibility package and emits a deprecation warning at runtime.
