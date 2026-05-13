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
- `EQTYService.submitAnchors()` automatically checks the queued batch fee on Anchor, uses EQTY when the signer already approved enough allowance for the Anchor contract, and otherwise pays with ETH by setting tx `value`.
- EQTY allowance is a separate action. If you want EQTY payment, approve the Anchor contract on the EQTY ERC20 before calling `submitAnchors()`.
- Use `MockEQTYService` for tests and local dev flows.

## Development

```bash
yarn workspace @ownables/adapter-ethers run build
yarn workspace @ownables/adapter-ethers run typecheck
```
