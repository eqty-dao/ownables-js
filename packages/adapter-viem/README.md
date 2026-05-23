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
- `EQTYService.submitAnchors()` automatically checks the queued batch fee on Anchor, uses EQTY when the signer already approved enough allowance for the Anchor contract, and otherwise pays with ETH by setting tx `value`.
- `EQTYService.emitPublicEvent()` uses the same automatic EQTY-vs-ETH fee selection and returns the canonical emitted public-event fields from the Anchor receipt for immediate local replay.
- EQTY allowance is a separate action. If you want EQTY payment, approve the Anchor contract on the EQTY ERC20 before calling `submitAnchors()`.
- Use `MockEQTYService` for tests and local dev flows.

## Development

```bash
yarn workspace @ownables/adapter-viem run build
yarn workspace @ownables/adapter-viem run typecheck
```
