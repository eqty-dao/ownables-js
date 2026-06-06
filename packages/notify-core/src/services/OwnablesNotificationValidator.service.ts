import type {
  OwnablesNotificationValidationResult,
  OwnablesNotifyAvailableV1,
} from "../types/Notify";
import {
  normalizeCaip10Account,
  normalizeEvmAddress,
  parseCaip10Account,
} from "./NotifyAccount.service.js";

const isIsoDate = (value: string): boolean => !Number.isNaN(Date.parse(value));
const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return Boolean(url.protocol && url.host);
  } catch {
    return false;
  }
};

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

    if (!payload.ownerAccount) {
      errors.push("ownerAccount is required");
    } else {
      try {
        normalizeCaip10Account(payload.ownerAccount);
      } catch {
        errors.push("ownerAccount must be a valid CAIP-10 account");
      }
    }

    if (!payload.issuerAddress) {
      errors.push("issuerAddress must be a valid EVM address");
    } else {
      try {
        normalizeEvmAddress(payload.issuerAddress, "issuerAddress must be a valid EVM address");
      } catch {
        errors.push("issuerAddress must be a valid EVM address");
      }
    }

    if (!payload.ownerAddress) {
      errors.push("ownerAddress must be a valid EVM address");
    } else {
      try {
        normalizeEvmAddress(payload.ownerAddress, "ownerAddress must be a valid EVM address");
      } catch {
        errors.push("ownerAddress must be a valid EVM address");
      }
    }

    if (payload.ownerAccount && payload.ownerAddress) {
      try {
        const ownerAccount = parseCaip10Account(payload.ownerAccount);
        const ownerAddress = normalizeEvmAddress(
          payload.ownerAddress,
          "ownerAddress must be a valid EVM address"
        );
        if (ownerAccount.namespace === "eip155" && ownerAccount.address !== ownerAddress) {
          errors.push("ownerAddress must match the EVM address in ownerAccount");
        }
      } catch {
        // account/address-specific errors are already recorded above
      }
    }

    if (!payload.url || !isValidUrl(payload.url)) {
      errors.push("url must be a valid absolute URL");
    }

    if (payload.scope === "nft") {
      if (!payload.nft) {
        errors.push("nft payload is required for scope=nft");
      } else {
        if (!payload.nft.network) {
          errors.push("nft.network is required for scope=nft");
        }
        if (!payload.nft.contract) {
          errors.push("nft.contract must be a valid EVM address for scope=nft");
        } else {
          try {
            normalizeEvmAddress(
              payload.nft.contract,
              "nft.contract must be a valid EVM address for scope=nft"
            );
          } catch {
            errors.push("nft.contract must be a valid EVM address for scope=nft");
          }
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
