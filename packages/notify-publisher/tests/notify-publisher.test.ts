import { describe, expect, it, vi } from "vitest";

import { NotifyPublisherService } from "../src";

describe("NotifyPublisherService", () => {
  it("publishes a built and validated notification", async () => {
    const transport = {
      publish: vi.fn().mockResolvedValue({ transportId: "msg_1" }),
    };

    const service = new NotifyPublisherService(transport, {
      now: () => new Date("2026-03-18T12:00:00.000Z"),
      idGenerator: () => "evt_fixed",
    });

    const result = await service.publishOwnableAvailable({
      topic: "wc:topic:1",
      ownableId: "owb_1",
      cid: "bafy123",
      scope: "direct",
      issuerAddress: "0x1111111111111111111111111111111111111111",
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
      metadata: { name: "Lunar Passport", icon: "https://cdn.example.com/icon.png" },
    });

    expect(result).toEqual({ transportId: "msg_1", eventId: "evt_fixed" });
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(transport.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "wc:topic:1",
        title: "Lunar Passport available",
      })
    );
  });

  it("fails before publishing when payload is invalid", async () => {
    const transport = {
      publish: vi.fn(),
    };

    const service = new NotifyPublisherService(transport, {
      idGenerator: () => "evt_fixed",
      now: () => new Date("2026-03-18T12:00:00.000Z"),
    });

    await expect(
      service.publishOwnableAvailable({
        topic: "wc:topic:1",
        ownableId: "owb_1",
        cid: "bafy123",
        scope: "direct",
        issuerAddress: "not-an-address",
        ownerAddress: "0x2222222222222222222222222222222222222222",
        accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
      })
    ).rejects.toThrow("Invalid ownables notification payload");

    expect(transport.publish).not.toHaveBeenCalled();
  });

  it("returns eventId even when transport does not include transportId", async () => {
    const transport = {
      publish: vi.fn().mockResolvedValue({}),
    };

    const service = new NotifyPublisherService(transport, {
      idGenerator: () => "evt_123",
      now: () => new Date("2026-03-18T12:00:00.000Z"),
    });

    const result = await service.publishOwnableAvailable({
      topic: "wc:topic:1",
      ownableId: "owb_1",
      cid: "bafy123",
      scope: "direct",
      issuerAddress: "0x1111111111111111111111111111111111111111",
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
      eventId: "evt_custom",
      createdAt: "2026-03-18T12:00:00.000Z",
    });

    expect(result).toEqual({ eventId: "evt_custom" });
  });
});
