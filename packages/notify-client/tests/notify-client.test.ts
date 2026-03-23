import { describe, expect, it, vi } from "vitest";

import {
  NotifyAcceptService,
  NotifyClientService,
  NotifyInboxService,
  type NotifyClientTransport,
  type NotifyRawMessage,
} from "../src";

const makeMessage = (eventId: string, receivedAt: string): NotifyRawMessage => ({
  id: `msg_${eventId}`,
  receivedAt,
  payload: {
    type: "ownables.v1.available",
    eventId,
    createdAt: "2026-03-18T10:00:00.000Z",
    ownableId: "owb_1",
    cid: "bafy123",
    scope: "direct",
    issuerAddress: "0x1111111111111111111111111111111111111111",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    accept: {
      url: "https://hub.example.com/api/v1/ownables/owb_1/download",
      method: "POST",
    },
  },
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
    await service.subscribe({ account: "0xabc" });

    expect(transport.initialize).toHaveBeenCalledTimes(1);
    expect(transport.register).toHaveBeenCalledTimes(1);
    expect(transport.subscribe).toHaveBeenCalledWith({ account: "0xabc" });
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
  it("dedupes by eventId and marks as read", () => {
    const inbox = new NotifyInboxService();
    const first = inbox.ingest(makeMessage("evt_1", "2026-03-18T10:00:00.000Z"));
    const second = inbox.ingest(makeMessage("evt_1", "2026-03-18T10:10:00.000Z"));

    expect(first).toEqual(second);
    expect(inbox.list()).toHaveLength(1);

    inbox.markRead("evt_1", "2026-03-18T11:00:00.000Z");
    expect(inbox.list()[0]?.readAt).toBe("2026-03-18T11:00:00.000Z");
  });

  it("sorts inbox descending and ignores unknown markRead", () => {
    const inbox = new NotifyInboxService();
    inbox.ingest(makeMessage("evt_2", "2026-03-18T09:00:00.000Z"));
    inbox.ingest(makeMessage("evt_1", "2026-03-18T10:00:00.000Z"));
    inbox.markRead("missing");

    expect(inbox.list().map((i) => i.eventId)).toEqual(["evt_1", "evt_2"]);
  });
});

describe("NotifyAcceptService", () => {
  it("posts to accept url and returns status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const service = new NotifyAcceptService({ fetchFn });
    const result = await service.accept({
      id: "msg_1",
      eventId: "evt_1",
      receivedAt: "2026-03-18T10:00:00.000Z",
      payload: makeMessage("evt_1", "2026-03-18T10:00:00.000Z").payload,
    });

    expect(result).toEqual({ ok: true, status: 201 });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://hub.example.com/api/v1/ownables/owb_1/download",
      { method: "POST" }
    );
  });

  it("defaults accept method to GET", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = new NotifyAcceptService({ fetchFn });
    const payload = makeMessage("evt_2", "2026-03-18T10:00:00.000Z").payload;
    delete (payload as any).accept.method;

    await service.accept({
      id: "msg_2",
      eventId: "evt_2",
      receivedAt: "2026-03-18T10:00:00.000Z",
      payload,
    });

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
        eventId: "evt_3",
        receivedAt: "2026-03-18T10:00:00.000Z",
        payload: makeMessage("evt_3", "2026-03-18T10:00:00.000Z").payload,
      });

      expect(result).toEqual({ ok: false, status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});
