import { describe, expect, it } from "vitest";

import {
  OwnablesNotificationBuilderService,
  OwnablesNotificationValidatorService,
  type OwnablesNotifyAvailableV1,
} from "../src";

const basePayload: OwnablesNotifyAvailableV1 = {
  type: "ownables.v1.available",
  eventId: "evt_1",
  createdAt: "2026-03-18T12:00:00.000Z",
  ownableId: "owb_1",
  cid: "bafy123",
  scope: "direct",
  issuerAddress: "0x1111111111111111111111111111111111111111",
  ownerAddress: "0x2222222222222222222222222222222222222222",
  accept: { url: "https://hub.example.com/api/v1/ownables/owb_1/download" },
};

describe("OwnablesNotificationBuilderService", () => {
  it("builds direct message copy with metadata name", () => {
    const builder = new OwnablesNotificationBuilderService();
    const envelope = builder.build({
      ...basePayload,
      metadata: { name: "Lunar Passport" },
    });

    expect(envelope.title).toBe("Lunar Passport available");
    expect(envelope.body).toBe(
      "Issued by 0x1111...1111. Review and accept to download."
    );
  });

  it("builds nft message copy fallback title", () => {
    const builder = new OwnablesNotificationBuilderService();
    const envelope = builder.build({
      ...basePayload,
      scope: "nft",
      nft: {
        network: "base",
        contract: "0x3333333333333333333333333333333333333333",
        tokenId: "77",
      },
    });

    expect(envelope.title).toBe("New Ownable available");
    expect(envelope.body).toBe(
      "Issued by 0x1111...1111 for NFT #77. Review and accept to download."
    );
  });
});

describe("OwnablesNotificationValidatorService", () => {
  it("validates a direct payload", () => {
    const validator = new OwnablesNotificationValidatorService();
    const result = validator.validate(basePayload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects non-EVM issuer and missing nft for nft scope", () => {
    const validator = new OwnablesNotificationValidatorService();
    const result = validator.validate({
      ...basePayload,
      scope: "nft",
      issuerAddress: "not-an-address",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("issuerAddress must be a valid EVM address");
    expect(result.errors).toContain("nft payload is required for scope=nft");
  });
});
