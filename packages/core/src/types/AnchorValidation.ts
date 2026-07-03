import type { Binary } from "eqty-core";

export interface AnchorValidationPair {
  key: Binary;
  value: Binary;
}

export interface AnchorValidationRecord {
  key: string;
  expectedValue: string;
  value: string;
  transactionHash?: string;
  timestamp?: number;
  blockNumber?: number;
  transactionIndex?: number;
  logIndex?: number;
  verified: boolean;
  source: "provider" | "indexed";
}

export interface AnchorValidationResult {
  verified: boolean;
  anchors: Record<string, string | undefined>;
  map: Record<string, string>;
  details: Record<string, AnchorValidationRecord>;
}

export interface IndexedAnchorRecord {
  key: string;
  value: string;
  transactionHash?: string;
  timestamp?: number;
  blockNumber?: number;
  transactionIndex?: number;
  logIndex?: number;
}

export interface AnchorValidationSource {
  validateAnchors(...anchors: Array<Binary | { hex: string } | { key: Binary | { hex: string }; value: Binary | { hex: string } }>): Promise<AnchorValidationResult>;
}
