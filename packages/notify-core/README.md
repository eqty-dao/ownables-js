# @ownables/notify-core

Shared notification payload types and helper services.

## Install

```bash
yarn add @ownables/notify-core
```

## Main exports

- `OwnablesNotificationBuilderService`
- `OwnablesNotificationValidatorService`
- Notify payload types

## Usage

Use this package for canonical event payload generation/validation (for example `ownables.v1.available`) so publisher and client stay aligned.

## Development

```bash
yarn workspace @ownables/notify-core run build
yarn workspace @ownables/notify-core run typecheck
```

