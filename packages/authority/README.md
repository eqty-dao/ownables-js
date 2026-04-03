# @ownables/authority

Authority domain/service package for Ownables authority-related operations.

## Install

```bash
yarn add @ownables/authority
```

## Main exports

- `AuthorityService`
- Authority service helpers
- Authority types

## Usage

```ts
import { AuthorityService } from "@ownables/authority";

const authority = new AuthorityService(/* dependencies */);
```

## Development

```bash
yarn workspace @ownables/authority run build
yarn workspace @ownables/authority run typecheck
```
