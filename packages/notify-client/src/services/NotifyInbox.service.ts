import type {
  NotifyRawMessage,
  OwnablesInboxItem,
} from "../types/NotifyClient";

export class NotifyInboxService {
  private readonly items = new Map<string, OwnablesInboxItem>();

  ingest(message: NotifyRawMessage): OwnablesInboxItem {
    const existing = this.items.get(message.payload.eventId);
    if (existing) {
      return existing;
    }

    const item: OwnablesInboxItem = {
      id: message.id,
      eventId: message.payload.eventId,
      receivedAt: message.receivedAt,
      payload: message.payload,
    };

    this.items.set(item.eventId, item);
    return item;
  }

  list(): OwnablesInboxItem[] {
    return Array.from(this.items.values()).sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt)
    );
  }

  markRead(eventId: string, readAt: string = new Date().toISOString()): void {
    const item = this.items.get(eventId);
    if (!item) {
      return;
    }

    const next: OwnablesInboxItem = {
      ...item,
      readAt,
    };

    this.items.set(eventId, next);
  }
}
