# Notify integration guide

This guide shows how to wire the new DI-based packages:

- `@ownables/notify-core`
- `@ownables/notify-client`
- `@ownables/notify-publisher`

Relay remains available but is deprecated, and the shared notify contract is now aligned with CAIP-10 account targeting plus URL-based import.

## 1) Shared payload contract

The canonical event type is `ownables.v1.available`.

Use `OwnablesNotificationBuilderService` + `OwnablesNotificationValidatorService` from `@ownables/notify-core` whenever you need consistent title/body generation and schema validation.

## 2) Publisher wiring (server-side)

Implement a transport for your server runtime and inject it into `NotifyPublisherService`.

```ts
import { NotifyPublisherService, type NotifyPublisherTransport } from "@ownables/notify-publisher";

class ReownPublisherTransport implements NotifyPublisherTransport {
  constructor(private readonly reownApi: {
    publish(input: {
      accounts: string[];
      notification: {
        type: string;
        title: string;
        body: string;
        icon?: string;
        url: string;
      };
    }): Promise<{ id?: string }>;
  }) {}

  async publish(request: {
    account: string;
    title: string;
    body: string;
    url: string;
    icon?: string;
    payload?: unknown;
  }): Promise<{ transportId?: string }> {
    const result = await this.reownApi.publish({
      accounts: [request.account],
      notification: {
        type: "ownables.v1.available",
        title: request.title,
        body: request.body,
        icon: request.icon,
        url: request.url,
      },
    });

    return { transportId: result.id };
  }
}

const publisher = new NotifyPublisherService(
  new ReownPublisherTransport(reownApi)
);

await publisher.publishOwnableAvailable({
  target: {
    account: "eip155:1:0x2222222222222222222222222222222222222222",
  },
  ownableId: "owb_01J...",
  cid: "bafy...",
  scope: "direct",
  issuerAddress: "0x1111111111111111111111111111111111111111",
  ownerAccount: "eip155:1:0x2222222222222222222222222222222222222222",
  ownerAddress: "0x2222222222222222222222222222222222222222",
  url: "https://hub.example.com/api/v1/ownables/owb_01J.../download",
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

class Web3InboxClientTransport implements NotifyClientTransport {
  constructor(private readonly web3Inbox: any) {}

  async initialize(): Promise<void> {
    await this.web3Inbox.initialize();
  }

  async register(): Promise<void> {
    await this.web3Inbox.register();
  }

  async subscribe(params: {
    account: string;
    scope?: "all" | "direct" | "nft";
    domain?: string;
  }): Promise<void> {
    await this.web3Inbox.subscribe(params.account, params.domain);
  }

  watchNotifications(handler: (message: any) => void): () => void {
    return this.web3Inbox.watchNotifications(handler);
  }

  watchSubscriptions(handler: (subscription: any) => void): () => void {
    return this.web3Inbox.watchSubscriptions(handler);
  }
}

const client = new NotifyClientService(new Web3InboxClientTransport(web3Inbox));
const inbox = new NotifyInboxService();
const accept = new NotifyAcceptService();

await client.initialize();
await client.register();
await client.subscribe({
  account: "eip155:1:0x2222222222222222222222222222222222222222",
  scope: "all",
  domain: "app.example.com",
});

const stop = client.watchNotifications((message) => {
  const item = inbox.ingest(message);

  // render item in wallet UI with an "Accept" button
  // on click: accept.accept(item)
});

// later: stop();
```

## 4) Suggested hub flow (no hub code required here)

At upload completion, your hub can call `publishOwnableAvailable` when policy says the owner should be notified.

The wallet then receives the notification and imports by fetching the notification `url` with `GET`.

## 5) Relay migration strategy

- Keep existing Relay code path as fallback only outside the shared notify contracts.
- Move new integrations to CAIP-10 account targeting and URL-based import.
- Once the Web3Inbox/Reown path is stable in production, remove Relay in a future major.
