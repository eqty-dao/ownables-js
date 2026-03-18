import type {
  NotifyClientTransport,
  NotifySubscriptionParams,
  NotifyRawMessage,
} from "../types/NotifyClient";

export class NotifyClientService {
  constructor(private readonly transport: NotifyClientTransport) {}

  async initialize(): Promise<void> {
    await this.transport.initialize();
  }

  async register(): Promise<void> {
    await this.transport.register();
  }

  async subscribe(params: NotifySubscriptionParams): Promise<void> {
    await this.transport.subscribe(params);
  }

  watchNotifications(handler: (message: NotifyRawMessage) => void): () => void {
    return this.transport.watchNotifications(handler);
  }

  watchSubscriptions(handler: (subscription: NotifySubscriptionParams) => void): () => void {
    return this.transport.watchSubscriptions(handler);
  }
}
