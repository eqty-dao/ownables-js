import { describe, expect, it, vi } from "vitest";

import {
  NotifyAcceptService,
  NotifyClientService,
  NotifyInboxService,
  type NotifyClientTransport,
  type NotifyRawMessage,
} from "../src";

const makeMessage = (id: string, receivedAt?: string): NotifyRawMessage => ({
  id,
  title: "Lunar Passport available",
  body: "Issued by 0x1111...1111. Open to review and download.",
  url: "https://hub.example.com/api/v1/ownables/owb_1/download",
  type: "ownables.v1.available",
  sentAt: "2026-03-18T10:00:00.000Z",
  ...(receivedAt ? { receivedAt } : {}),
});

describe("NotifyClientService", () => {
  it("delegates lifecycle methods to transport", async () => {
    const transport: NotifyClientTransport = {
      initialize: vi.fn(),
      register: vi.fn(),
      subscribe: vi.fn(),
      watchNotifications: vi.fn().mockReturnValue(() => undefined),
      watchSubscriptions: vi.fn().mockReturnValue(() => undefined),
    };

    const service = new NotifyClientService(transport);
    await service.initialize();
    await service.register();
    await service.subscribe({ account: "eip155:1:0xabc", domain: "app.example.com" });

    expect(transport.initialize).toHaveBeenCalledTimes(1);
    expect(transport.register).toHaveBeenCalledTimes(1);
    expect(transport.subscribe).toHaveBeenCalledWith({
      account: "eip155:1:0xabc",
      domain: "app.example.com",
    });
  });

  it("forwards watch handlers to transport", () => {
    const unwatch = vi.fn();
    const transport: NotifyClientTransport = {
      initialize: vi.fn(),
      register: vi.fn(),
      subscribe: vi.fn(),
      watchNotifications: vi.fn().mockReturnValue(unwatch),
      watchSubscriptions: vi.fn().mockReturnValue(unwatch),
    };
    const service = new NotifyClientService(transport);

    const a = service.watchNotifications(vi.fn());
    const b = service.watchSubscriptions(vi.fn());

    expect(transport.watchNotifications).toHaveBeenCalledTimes(1);
    expect(transport.watchSubscriptions).toHaveBeenCalledTimes(1);
    expect(a).toBe(unwatch);
    expect(b).toBe(unwatch);
  });
});

describe("NotifyInboxService", () => {
  it("dedupes by transport notification id and marks as read", () => {
    const inbox = new NotifyInboxService();
    const first = inbox.ingest(makeMessage("msg_1", "2026-03-18T10:00:00.000Z"));
    const second = inbox.ingest(makeMessage("msg_1", "2026-03-18T10:10:00.000Z"));

    expect(first).toEqual(second);
    expect(inbox.list()).toHaveLength(1);

    inbox.markRead("msg_1", "2026-03-18T11:00:00.000Z");
    expect(inbox.list()[0]?.readAt).toBe("2026-03-18T11:00:00.000Z");
    expect(inbox.list()[0]?.isRead).toBe(true);
  });

  it("sorts inbox descending and falls back to sentAt when receivedAt is missing", () => {
    const inbox = new NotifyInboxService();
    inbox.ingest(makeMessage("msg_2", "2026-03-18T09:00:00.000Z"));
    inbox.ingest(makeMessage("msg_1"));
    inbox.markRead("missing");

    expect(inbox.list().map((i) => i.id)).toEqual(["msg_1", "msg_2"]);
  });
});

describe("NotifyAcceptService", () => {
  it("gets the notification url and returns status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new NotifyAcceptService({ fetchFn });
    const result = await service.accept({
      id: "msg_1",
      title: "Lunar Passport available",
      body: "Issued by 0x1111...1111. Open to review and download.",
      url: "https://hub.example.com/api/v1/ownables/owb_1/download",
      type: "ownables.v1.available",
      receivedAt: "2026-03-18T10:00:00.000Z",
      isRead: false,
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://hub.example.com/api/v1/ownables/owb_1/download",
      { method: "GET" }
    );
  });

  it("uses global fetch when no fetchFn is injected", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    (globalThis as any).fetch = fetchMock;

    try {
      const service = new NotifyAcceptService();
      const result = await service.accept({
        id: "msg_3",
        title: "Lunar Passport available",
        body: "Issued by 0x1111...1111. Open to review and download.",
        url: "https://hub.example.com/api/v1/ownables/owb_1/download",
        type: "ownables.v1.available",
        receivedAt: "2026-03-18T10:00:00.000Z",
        isRead: false,
      });

      expect(result).toEqual({ ok: false, status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});
