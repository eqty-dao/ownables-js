import type { ParsedCaip10Account } from "../types/Notify.js";

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CAIP10_ACCOUNT_REGEX = /^([a-zA-Z0-9-]+):([a-zA-Z0-9-]+):([^:\s]+)$/;

export function parseCaip10Account(account: string): ParsedCaip10Account {
  const trimmed = account.trim();
  const match = CAIP10_ACCOUNT_REGEX.exec(trimmed);
  if (!match) {
    throw new Error("Invalid CAIP-10 account");
  }

  const namespaceRaw = match[1];
  const referenceRaw = match[2];
  const addressRaw = match[3];
  if (!namespaceRaw || !referenceRaw || !addressRaw) {
    throw new Error("Invalid CAIP-10 account");
  }

  const namespace = namespaceRaw.toLowerCase();
  const reference = referenceRaw.toLowerCase();
  const address =
    namespace === "eip155" ? normalizeEvmAddress(addressRaw, "Invalid CAIP-10 account") : addressRaw;

  return {
    namespace,
    reference,
    chainId: `${namespace}:${reference}`,
    address,
    account: `${namespace}:${reference}:${address}`,
  };
}

export function normalizeCaip10Account(account: string): string {
  return parseCaip10Account(account).account;
}

export function normalizeEvmAddress(
  address: string,
  errorMessage: string = "Invalid EVM address"
): string {
  const normalized = address.trim().toLowerCase();
  if (!EVM_ADDRESS_REGEX.test(normalized)) {
    throw new Error(errorMessage);
  }
  return normalized;
}
