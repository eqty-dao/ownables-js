# dossier contract

Dossier ownable contract with generic attachment and close support.

## Build artifacts

Run:

```bash
./scripts/build.sh
```

This generates:

- `artifacts/ownable-dossier.wasm`
- `artifacts/code-hash-manifest.json`
- `schema/*.json`

The manifest hash is used by the JS builder package to verify the pinned contract artifact.
