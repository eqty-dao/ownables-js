# @ownables/adapter-ethers

Ethers-based EVM adapter services for Ownables integrations.

## Install

```bash
yarn add @ownables/adapter-ethers
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
yarn workspace @ownables/adapter-ethers run build
yarn workspace @ownables/adapter-ethers run typecheck
```

