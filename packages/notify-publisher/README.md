# @ownables/notify-publisher

DI service for publishing Ownables notification events from server-side runtimes.

## Install

```bash
yarn add @ownables/notify-publisher
```

## Main exports

- `NotifyPublisherService`
- Notify publisher types

## Quick start

```ts
import {
  NotifyPublisherService,
  type NotifyPublisherTransport,
} from "@ownables/notify-publisher";

const publisher = new NotifyPublisherService(transport);
await publisher.publishOwnableAvailable(payload);
```

Provide your own `NotifyPublisherTransport` implementation and inject it.
The transport request carries the explicit fields a Reown-style adapter needs: `account`, `title`, `body`, `url`, optional `icon`, and optional validated `payload`.

## Development

```bash
yarn workspace @ownables/notify-publisher run build
yarn workspace @ownables/notify-publisher run typecheck
```
