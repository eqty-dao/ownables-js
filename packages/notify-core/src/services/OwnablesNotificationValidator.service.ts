import type {
  OwnablesNotificationValidationResult,
  OwnablesNotifyAvailableV1,
} from "../types/Notify";

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const isIsoDate = (value: string): boolean => !Number.isNaN(Date.parse(value));

export class OwnablesNotificationValidatorService {
  validate(payload: OwnablesNotifyAvailableV1): OwnablesNotificationValidationResult {
    const errors: string[] = [];

    if (payload.type !== "ownables.v1.available") {
      errors.push("type must be ownables.v1.available");
    }

    if (!payload.eventId) {
      errors.push("eventId is required");
    }

    if (!payload.createdAt || !isIsoDate(payload.createdAt)) {
      errors.push("createdAt must be a valid ISO-8601 date string");
    }

    if (!payload.ownableId) {
      errors.push("ownableId is required");
    }

    if (!payload.cid) {
      errors.push("cid is required");
    }

    if (!EVM_ADDRESS_REGEX.test(payload.issuerAddress)) {
      errors.push("issuerAddress must be a valid EVM address");
    }

    if (!EVM_ADDRESS_REGEX.test(payload.ownerAddress)) {
      errors.push("ownerAddress must be a valid EVM address");
    }

    if (!payload.accept?.url) {
      errors.push("accept.url is required");
    }

    if (payload.scope === "nft") {
      if (!payload.nft) {
        errors.push("nft payload is required for scope=nft");
      } else {
        if (!payload.nft.network) {
          errors.push("nft.network is required for scope=nft");
        }
        if (!payload.nft.contract || !EVM_ADDRESS_REGEX.test(payload.nft.contract)) {
          errors.push("nft.contract must be a valid EVM address for scope=nft");
        }
        if (!payload.nft.tokenId) {
          errors.push("nft.tokenId is required for scope=nft");
        }
      }
    }

    if (payload.scope === "direct" && payload.nft) {
      errors.push("nft payload must be omitted for scope=direct");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  assertValid(payload: OwnablesNotifyAvailableV1): void {
    const result = this.validate(payload);
    if (!result.valid) {
      throw new Error(`Invalid ownables notification payload: ${result.errors.join("; ")}`);
    }
  }
}
