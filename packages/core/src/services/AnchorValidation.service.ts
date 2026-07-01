import { Binary } from "eqty-core";
import type {
  AnchorValidationPair,
  AnchorValidationRecord,
  AnchorValidationResult,
  AnchorValidationSource,
  IndexedAnchorRecord,
} from "../types/AnchorValidation.js";

export const ZERO_ANCHOR_VALUE = Binary.fromHex(`0x${"0".repeat(64)}`);

type AnchorValidationInput = Binary | { hex: string } | { key: Binary | { hex: string }; value: Binary | { hex: string } };

function toBinary(value: Binary | { hex: string }): Binary {
  return value instanceof Binary ? value : Binary.fromHex(value.hex);
}

export function normalizeAnchorValidationPairs(...anchors: AnchorValidationInput[]): AnchorValidationPair[] {
  if (anchors.length === 0) {
    return [];
  }

  const pairs: AnchorValidationPair[] = [];
  const first = anchors[0] as AnchorValidationInput | undefined;
  if (first instanceof Binary || ("hex" in (first as { hex?: string }) && !("key" in (first as { key?: unknown })))) {
    for (const anchor of anchors as Array<Binary | { hex: string }>) {
      pairs.push({ key: toBinary(anchor), value: ZERO_ANCHOR_VALUE });
    }
    return pairs;
  }

  for (const anchor of anchors as Array<{ key: Binary | { hex: string }; value: Binary | { hex: string } }>) {
    pairs.push({
      key: toBinary(anchor.key),
      value: toBinary(anchor.value),
    });
  }

  return pairs;
}

function createValidationRecord(
  pair: AnchorValidationPair,
  source: AnchorValidationRecord["source"],
  evidence?: IndexedAnchorRecord
): AnchorValidationRecord {
  const expectedValue = pair.value.hex.toLowerCase();
  const actualValue = (evidence?.value ?? pair.value.hex).toLowerCase();
  const verified = pair.value.hex === ZERO_ANCHOR_VALUE.hex || actualValue === expectedValue;

  return {
    key: pair.key.hex,
    expectedValue,
    value: actualValue,
    verified,
    source,
    ...(evidence?.transactionHash !== undefined ? { transactionHash: evidence.transactionHash } : {}),
    ...(evidence?.timestamp !== undefined ? { timestamp: evidence.timestamp } : {}),
    ...(evidence?.blockNumber !== undefined ? { blockNumber: evidence.blockNumber } : {}),
    ...(evidence?.transactionIndex !== undefined ? { transactionIndex: evidence.transactionIndex } : {}),
    ...(evidence?.logIndex !== undefined ? { logIndex: evidence.logIndex } : {}),
  };
}

export function buildAnchorValidationResult(
  pairs: AnchorValidationPair[],
  records: Array<AnchorValidationRecord | undefined>
): AnchorValidationResult {
  const anchors: Record<string, string | undefined> = {};
  const map: Record<string, string> = {};
  const details: Record<string, AnchorValidationRecord> = {};
  let verified = pairs.length > 0;

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (!pair) continue;

    const record = records[index] ?? createValidationRecord(pair, "provider");
    anchors[pair.key.hex] = record.transactionHash;
    map[pair.key.hex] = record.value;
    details[pair.key.hex] = record;

    if (!record.transactionHash || !record.verified) {
      verified = false;
    }
  }

  return {
    verified,
    anchors,
    map,
    details,
  };
}

function indexedAnchorSort(a: IndexedAnchorRecord, b: IndexedAnchorRecord): number {
  const byBlock = (a.blockNumber ?? Number.MIN_SAFE_INTEGER) - (b.blockNumber ?? Number.MIN_SAFE_INTEGER);
  if (byBlock !== 0) return byBlock;
  const byTx = (a.transactionIndex ?? Number.MIN_SAFE_INTEGER) - (b.transactionIndex ?? Number.MIN_SAFE_INTEGER);
  if (byTx !== 0) return byTx;
  return (a.logIndex ?? Number.MIN_SAFE_INTEGER) - (b.logIndex ?? Number.MIN_SAFE_INTEGER);
}

export function validateAnchorsAgainstIndexedRecords(
  anchors: AnchorValidationInput[],
  indexedRecords: IndexedAnchorRecord[]
): AnchorValidationResult {
  const pairs = normalizeAnchorValidationPairs(...anchors);
  const latestByKey = new Map<string, IndexedAnchorRecord>();

  for (const record of [...indexedRecords].sort(indexedAnchorSort)) {
    latestByKey.set(record.key.toLowerCase(), record);
  }

  const records = pairs.map((pair) => {
    const evidence = latestByKey.get(pair.key.hex.toLowerCase());
    return evidence ? createValidationRecord(pair, "indexed", evidence) : undefined;
  });

  return buildAnchorValidationResult(pairs, records);
}

export async function validateAnchorsWithSource(
  source: {
    verifyAnchors(...anchors: AnchorValidationInput[]): Promise<AnchorValidationResult>;
    validateAnchors?: AnchorValidationSource["validateAnchors"];
  },
  ...anchors: AnchorValidationInput[]
): Promise<AnchorValidationResult> {
  if (typeof source.validateAnchors === "function") {
    return source.validateAnchors(...anchors);
  }

  return source.verifyAnchors(...anchors);
}
