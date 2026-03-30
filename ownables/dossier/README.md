# dossier contract

Shared static ownable contract for browser-first builder flows.

## Build artifacts

Run:

```bash
./scripts/build.sh
```

This generates:

- `artifacts/ownable-static.wasm`
- `artifacts/code-hash-manifest.json`
- `schema/*.json`

The manifest hash is used by the JS builder package to verify the pinned contract artifact.
