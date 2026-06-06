export interface NotifySubscriptionParams {
  account: string;
  scope?: "all" | "direct" | "nft";
  domain?: string;
}

export interface NotifyRawMessage {
  id: string;
  title: string;
  body: string;
  url: string;
  type: string;
  sentAt?: string;
  receivedAt?: string;
  isRead?: boolean;
}

export interface OwnablesInboxItem {
  id: string;
  title: string;
  body: string;
  url: string;
  type: string;
  sentAt?: string;
  receivedAt: string;
  isRead: boolean;
  readAt?: string;
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
