import { describe, expect, it } from "vitest";

import {
  OwnablesNotificationBuilderService,
  OwnablesNotificationValidatorService,
  normalizeCaip10Account,
  parseCaip10Account,
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
  ownerAccount: "eip155:1:0x2222222222222222222222222222222222222222",
  ownerAddress: "0x2222222222222222222222222222222222222222",
  url: "https://hub.example.com/api/v1/ownables/owb_1/download",
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
      "Issued by 0x1111...1111. Open to review and download."
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
      "Issued by 0x1111...1111 for NFT #77. Open to review and download."
    );
  });

  it("keeps short issuer and falls back for blank metadata/nft token", () => {
    const builder = new OwnablesNotificationBuilderService();
    const envelope = builder.build({
      ...basePayload,
      issuerAddress: "0x1234",
      scope: "nft",
      metadata: { name: "   " },
      nft: {
        network: "base",
        contract: "0x3333333333333333333333333333333333333333",
        tokenId: "",
      },
    } as any);

    expect(envelope.title).toBe("New Ownable available");
    expect(envelope.body).toBe(
      "Issued by 0x1234 for NFT #. Open to review and download."
    );
  });

  it("falls back to '?' when nft tokenId is missing", () => {
    const builder = new OwnablesNotificationBuilderService();
    const envelope = builder.build({
      ...basePayload,
      scope: "nft",
      nft: {
        network: "base",
        contract: "0x3333333333333333333333333333333333333333",
      } as any,
    });

    expect(envelope.body).toBe(
      "Issued by 0x1111...1111 for NFT #?. Open to review and download."
    );
  });
});

describe("notify account helpers", () => {
  it("normalizes and parses CAIP-10 EVM accounts", () => {
    expect(normalizeCaip10Account(" EIP155:1:0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD ")).toBe(
      "eip155:1:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    );
    expect(parseCaip10Account("eip155:8453:0x2222222222222222222222222222222222222222")).toEqual({
      namespace: "eip155",
      reference: "8453",
      chainId: "eip155:8453",
      address: "0x2222222222222222222222222222222222222222",
      account: "eip155:8453:0x2222222222222222222222222222222222222222",
    });
  });

  it("rejects malformed CAIP-10 accounts", () => {
    expect(() => normalizeCaip10Account("not-an-account")).toThrow("Invalid CAIP-10 account");
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

  it("rejects invalid payload shapes and assertValid throws", () => {
    const validator = new OwnablesNotificationValidatorService();
    const result = validator.validate({
      ...basePayload,
      type: "wrong.type" as any,
      createdAt: "not-a-date",
      eventId: "",
      ownableId: "",
      cid: "",
      ownerAccount: "bad",
      ownerAddress: "bad",
      url: "",
      scope: "direct",
      nft: {
        network: "base",
        contract: "0x3333333333333333333333333333333333333333",
        tokenId: "7",
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("type must be ownables.v1.available");
    expect(result.errors).toContain("createdAt must be a valid ISO-8601 date string");
    expect(result.errors).toContain("ownerAccount must be a valid CAIP-10 account");
    expect(result.errors).toContain("nft payload must be omitted for scope=direct");
    expect(() => validator.assertValid({ ...basePayload, ownerAddress: "bad" } as any)).toThrow(
      "Invalid ownables notification payload"
    );
  });

  it("validates nft scope contract and token fields", () => {
    const validator = new OwnablesNotificationValidatorService();
    const result = validator.validate({
      ...basePayload,
      scope: "nft",
      nft: {
        network: "",
        contract: "bad",
        tokenId: "",
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("nft.network is required for scope=nft");
    expect(result.errors).toContain("nft.contract must be a valid EVM address for scope=nft");
    expect(result.errors).toContain("nft.tokenId is required for scope=nft");
  });

  it("rejects mismatched ownerAccount and ownerAddress and blank urls", () => {
    const validator = new OwnablesNotificationValidatorService();
    const result = validator.validate({
      ...basePayload,
      ownerAccount: "eip155:1:0x3333333333333333333333333333333333333333",
      url: "   ",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ownerAddress must match the EVM address in ownerAccount");
    expect(result.errors).toContain("url must be a valid absolute URL");
  });
});
