# @ownables/builder

Ownable package preparation and deploy orchestration for browser and Node.js.

## Install

```bash
yarn add @ownables/builder
```

## Main exports

- `BuilderService`

## Quick start

```ts
import { BuilderService } from '@ownables/builder';

const builder = new BuilderService({ packageService, deployAdapter: adapter });

const prepared = await builder.prepareOwnable({
  name: 'My Ownable',
  description: 'Ownable deployment',
  files,
});

const instantiateMsg = builder.buildInstantiateMsg({
  name: 'My Ownable',
  description: 'Ownable deployment',
  packageCid: prepared.packageCid,
  networkId,
});

const result = await builder.deploy({
  wasm,
  instantiateMsg,
  expectedCodeHash,
});
```

## Wasm loading examples

`builder.deploy(...)` expects `wasm: Uint8Array`.

### Node.js

```ts
import { readFile } from 'node:fs/promises';

async function loadWasmNode(): Promise<Uint8Array> {
  return await readFile('./ownable_bg.wasm');
}
```

### Vite

```ts
import ownableWasmUrl from '@ownables/builder/ownable_bg.wasm?url';

async function loadWasmVite(): Promise<Uint8Array> {
  const res = await fetch(ownableWasmUrl);
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

### Browser (generic static fetch)

Copy `ownable_bg.wasm` from the npm package to you publicly served folder (typically `/public`).

```ts
async function loadWasmBrowser(): Promise<Uint8Array> {
  const res = await fetch('/ownable_bg.wasm');
  if (!res.ok) throw new Error(`Failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

## Development

```bash
yarn workspace @ownables/builder run build
yarn workspace @ownables/builder run typecheck
```

`prepack` ensures `ownable_bg.wasm` exists before packaging.
