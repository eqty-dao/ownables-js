# Notify integration guide

This guide shows how to wire the new DI-based packages:

- `@ownables/notify-core`
- `@ownables/notify-client`
- `@ownables/notify-publisher`

Relay remains available but is deprecated.

## 1) Shared payload contract

The canonical event type is `ownables.v1.available`.

Use `OwnablesNotificationBuilderService` + `OwnablesNotificationValidatorService` from `@ownables/notify-core` whenever you need consistent title/body generation and schema validation.

## 2) Publisher wiring (server-side)

Implement a transport for your server runtime and inject it into `NotifyPublisherService`.

```ts
import { NotifyPublisherService, type NotifyPublisherTransport } from "@ownables/notify-publisher";

class WalletConnectPublisherTransport implements NotifyPublisherTransport {
  constructor(private readonly wcNotifyApi: {
    publish(input: {
      topic: string;
      title: string;
      body: string;
      icon?: string;
      data: unknown;
    }): Promise<{ id?: string }>;
  }) {}

  async publish(request: {
    topic: string;
    title: string;
    body: string;
    icon?: string;
    payload: unknown;
  }): Promise<{ transportId?: string }> {
    const result = await this.wcNotifyApi.publish({
      topic: request.topic,
      title: request.title,
      body: request.body,
      icon: request.icon,
      data: request.payload,
    });

    return { transportId: result.id };
  }
}

const publisher = new NotifyPublisherService(
  new WalletConnectPublisherTransport(walletConnectNotifyApi)
);

await publisher.publishOwnableAvailable({
  topic: "wc:topic:example",
  ownableId: "owb_01J...",
  cid: "bafy...",
  scope: "direct",
  issuerAddress: "0x1111111111111111111111111111111111111111",
  ownerAddress: "0x2222222222222222222222222222222222222222",
  accept: { url: "https://hub.example.com/api/v1/ownables/owb_01J.../download", method: "POST" },
  metadata: { name: "Lunar Passport", icon: "https://cdn.example.com/lunar-passport.png" },
});
```

## 3) Client wiring (wallet/app-side)

Implement a client transport and inject it into `NotifyClientService`.

```ts
import {
  NotifyClientService,
  NotifyInboxService,
  NotifyAcceptService,
  type NotifyClientTransport,
} from "@ownables/notify-client";

class WalletConnectClientTransport implements NotifyClientTransport {
  constructor(private readonly wcNotifyClient: any) {}

  async initialize(): Promise<void> {
    await this.wcNotifyClient.initialize();
  }

  async register(): Promise<void> {
    await this.wcNotifyClient.register();
  }

  async subscribe(params: { account: string; scope?: "all" | "direct" | "nft" }): Promise<void> {
    await this.wcNotifyClient.subscribe(params);
  }

  watchNotifications(handler: (message: any) => void): () => void {
    return this.wcNotifyClient.watchNotifications(handler);
  }

  watchSubscriptions(handler: (subscription: any) => void): () => void {
    return this.wcNotifyClient.watchSubscriptions(handler);
  }
}

const client = new NotifyClientService(new WalletConnectClientTransport(walletConnectNotifyClient));
const inbox = new NotifyInboxService();
const accept = new NotifyAcceptService();

await client.initialize();
await client.register();
await client.subscribe({ account: "0x2222222222222222222222222222222222222222", scope: "all" });

const stop = client.watchNotifications((message) => {
  const item = inbox.ingest(message);

  // render item in wallet UI with an "Accept" button
  // on click: accept.accept(item)
});

// later: stop();
```

## 4) Suggested hub flow (no hub code required here)

At upload completion, your hub can call `publishOwnableAvailable` when policy says the owner should be notified (for example: uploader is not owner).

The wallet then receives the event and executes the `accept.url` flow.

## 5) Relay migration strategy

- Keep existing Relay code path as fallback.
- Add feature flag to enable Notify path per environment.
- Once Notify path is stable in production, remove Relay in a future major.
