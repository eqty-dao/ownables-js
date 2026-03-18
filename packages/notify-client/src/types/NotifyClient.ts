import type { OwnablesNotifyAvailableV1 } from "@ownables/notify-core";

export interface NotifySubscriptionParams {
  account: string;
  scope?: "all" | "direct" | "nft";
}

export interface NotifyRawMessage {
  id: string;
  receivedAt: string;
  payload: OwnablesNotifyAvailableV1;
}

export interface OwnablesInboxItem {
  id: string;
  eventId: string;
  receivedAt: string;
  readAt?: string;
  payload: OwnablesNotifyAvailableV1;
}

export interface NotifyAcceptResult {
  ok: boolean;
  status: number;
}

export interface NotifyClientTransport {
  initialize(): Promise<void>;
  register(): Promise<void>;
  subscribe(params: NotifySubscriptionParams): Promise<void>;
  watchNotifications(handler: (message: NotifyRawMessage) => void): () => void;
  watchSubscriptions(handler: (subscription: NotifySubscriptionParams) => void): () => void;
}
