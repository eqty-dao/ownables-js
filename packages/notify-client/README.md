# @ownables/notify-client

DI services for wallet/app-side notification lifecycle.

## Install

```bash
yarn add @ownables/notify-client
```

## Main exports

- `NotifyClientService`
- `NotifyInboxService`
- `NotifyAcceptService`
- Notify client types

## Quick start

```ts
import {
  NotifyClientService,
  NotifyInboxService,
  NotifyAcceptService,
} from "@ownables/notify-client";

const client = new NotifyClientService(transport);
const inbox = new NotifyInboxService();
const accept = new NotifyAcceptService();
```

Provide your own `NotifyClientTransport` implementation and inject it.
`subscribe()` now uses a CAIP-10 `account` and optional `domain`, and inbox messages are expected to look like Web3Inbox notifications with `id`, `title`, `body`, `url`, `type`, and optional `sentAt` / `receivedAt` / `isRead`.

## Development

```bash
yarn workspace @ownables/notify-client run build
yarn workspace @ownables/notify-client run typecheck
```
