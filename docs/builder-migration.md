# Builder migration: `@ownables/builder-client` -> `@ownables/builder`

`@ownables/builder-client` (obuilder transport) is deprecated.
Use `@ownables/builder` for browser-first package preparation and deployment.

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
  description: "Browser-first ownable",
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

## Compatibility window

`@ownables/builder-client` remains available for one release cycle as a compatibility package and emits a deprecation warning at runtime.
