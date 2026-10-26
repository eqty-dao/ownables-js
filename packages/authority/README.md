# @ownables/authority

Authority domain/service package for Ownables authority-related operations.

## Lockable NFT bridge deprecation

The Lockable NFT bridge and unlock-proof APIs in `AuthorityService` are deprecated. New
integrations should publish public events and use ordinary Ownable upload and
verification instead of creating new Lockable NFT bridges. These flows do not
unlock NFTs that are already locked.

Existing bridge records remain readable, and unlock-proof access remains
operational while active locks and a recovery route are assessed. No removal
date has been set. Consumers with locked NFTs should retain their current
unlock integration until a verified recovery path is available.

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
import { AuthorityService } from '@ownables/authority';

const authority = new AuthorityService(/* dependencies */);
```

## Development

```bash
yarn workspace @ownables/authority run build
yarn workspace @ownables/authority run typecheck
```
