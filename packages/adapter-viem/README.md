# @ownables/adapter-viem

Viem-based EVM adapter services for Ownables integrations.

## Install

```bash
yarn add @ownables/adapter-viem
```

## Main exports

- `EQTYService`
- `MockEQTYService`
- `EQTY` types

## Usage

- Use `EQTYService` for real chain/provider integrations.
- Use `MockEQTYService` for tests and local dev flows.

## Development

```bash
yarn workspace @ownables/adapter-viem run build
yarn workspace @ownables/adapter-viem run typecheck
```

