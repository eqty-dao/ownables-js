import type {
  NotifyRawMessage,
  OwnablesInboxItem,
} from "../types/NotifyClient";

export class NotifyInboxService {
  private readonly items = new Map<string, OwnablesInboxItem>();

  ingest(message: NotifyRawMessage): OwnablesInboxItem {
    const existing = this.items.get(message.id);
    if (existing) {
      return existing;
    }

    const item: OwnablesInboxItem = {
      id: message.id,
      title: message.title,
      body: message.body,
      url: message.url,
      type: message.type,
      receivedAt: message.receivedAt ?? message.sentAt ?? new Date().toISOString(),
      isRead: message.isRead ?? false,
      ...(message.sentAt ? { sentAt: message.sentAt } : {}),
    };

    this.items.set(item.id, item);
    return item;
  }

  list(): OwnablesInboxItem[] {
    return Array.from(this.items.values()).sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt)
    );
  }

  markRead(id: string, readAt: string = new Date().toISOString()): void {
    const item = this.items.get(id);
    if (!item) {
      return;
    }

    const next: OwnablesInboxItem = {
      ...item,
      isRead: true,
      readAt,
    };

    this.items.set(id, next);
  }
}
