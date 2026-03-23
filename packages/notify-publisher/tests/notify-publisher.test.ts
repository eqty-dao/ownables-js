import { describe, expect, it, vi } from "vitest";

import { NotifyPublisherService } from "../src";
import {
  OwnablesNotificationBuilderService,
  OwnablesNotificationValidatorService,
} from "@ownables/notify-core";

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

  it("supports injected builder and validator dependencies", async () => {
    const transport = {
      publish: vi.fn().mockResolvedValue({ transportId: "msg_dep" }),
    };
    const builder = {
      build: vi.fn().mockReturnValue({
        title: "Injected title",
        body: "Injected body",
        payload: {
          type: "ownables.v1.available",
          eventId: "evt_dep",
          createdAt: "2026-03-18T12:00:00.000Z",
          ownableId: "owb_1",
          cid: "bafy123",
          scope: "direct",
          issuerAddress: "0x1111111111111111111111111111111111111111",
          ownerAddress: "0x2222222222222222222222222222222222222222",
          accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
        },
      }),
    } as unknown as OwnablesNotificationBuilderService;
    const validator = {
      assertValid: vi.fn(),
    } as unknown as OwnablesNotificationValidatorService;

    const service = new NotifyPublisherService(transport, {
      builder,
      validator,
      idGenerator: () => "evt_dep",
      now: () => new Date("2026-03-18T12:00:00.000Z"),
    });

    const result = await service.publishOwnableAvailable({
      topic: "wc:topic:dep",
      ownableId: "owb_1",
      cid: "bafy123",
      scope: "direct",
      issuerAddress: "0x1111111111111111111111111111111111111111",
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
    });

    expect(result).toEqual({ transportId: "msg_dep", eventId: "evt_dep" });
    expect(validator.assertValid).toHaveBeenCalledTimes(1);
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(transport.publish).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Injected title", body: "Injected body" })
    );
  });

  it("uses default id/createdAt generation when not provided", async () => {
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const transport = {
      publish: vi.fn().mockResolvedValue({}),
    };

    try {
      const service = new NotifyPublisherService(transport as any, {
        now: () => new Date("2026-03-18T12:00:00.000Z"),
      });

      const result = await service.publishOwnableAvailable({
        topic: "wc:topic:auto",
        ownableId: "owb_1",
        cid: "bafy123",
        scope: "direct",
        issuerAddress: "0x1111111111111111111111111111111111111111",
        ownerAddress: "0x2222222222222222222222222222222222222222",
        accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
      });

      expect(result.eventId).toMatch(/^evt_20260318120000000_/);
      expect(transport.publish).toHaveBeenCalledWith(
        expect.not.objectContaining({ icon: expect.anything() })
      );
    } finally {
      randSpy.mockRestore();
    }
  });

  it("uses default constructor dependencies and forwards nft payload", async () => {
    const transport = {
      publish: vi.fn().mockResolvedValue({ transportId: "msg_nft" }),
    };

    const service = new NotifyPublisherService(transport as any);
    const result = await service.publishOwnableAvailable({
      topic: "wc:topic:nft",
      ownableId: "owb_1",
      cid: "bafy123",
      scope: "nft",
      issuerAddress: "0x1111111111111111111111111111111111111111",
      ownerAddress: "0x2222222222222222222222222222222222222222",
      accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
      eventId: "evt_nft",
      nft: {
        network: "base",
        contract: "0x3333333333333333333333333333333333333333",
        tokenId: "77",
      },
    });

    expect(result).toEqual({ transportId: "msg_nft", eventId: "evt_nft" });
    expect(transport.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          createdAt: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
          ),
          scope: "nft",
          nft: expect.objectContaining({ tokenId: "77" }),
        }),
      })
    );
  });
});
