# @ownables/builder-client

DEPRECATED obuilder API client.

Use `@ownables/builder` for new integrations.

## Install

```bash
yarn add @ownables/builder-client
```

## Main exports

- `BuilderService`
- Builder client types

## Legacy usage

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

## Migration

- `upload(...)` -> `prepareOwnable(...)` + `buildInstantiateMsg(...)` + `deploy(...)`
- `getTemplateCost(...)` -> `estimateCost(...)`

