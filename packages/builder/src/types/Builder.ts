import type { TypedPackage } from "@ownables/core";

export const FIXED_OWNABLE_TYPE = "static_image";

export interface OwnableMetadataInput {
  name: string;
  description: string;
  keywords?: string[];
}

export interface PrepareOwnableInput extends OwnableMetadataInput {
  files: File[];
  packageService: {
    processPackage(files: File[]): Promise<TypedPackage | null | undefined>;
  };
}

export interface PreparedOwnable {
  packageCid: string;
  pkg: TypedPackage;
}

export interface BuildInstantiateMsgInput extends OwnableMetadataInput {
  packageCid: string;
  networkId: number;
  nft?: unknown;
}

export interface InstantiateMsgPayload {
  name: string;
  description: string;
  package: string;
  network_id: number;
  ownable_type: string;
  keywords: string[];
  nft?: unknown;
}

export interface DeployParams {
  instantiateMsg: InstantiateMsgPayload;
  wasm: Uint8Array;
  expectedCodeHash?: string;
}

export interface DeployResult {
  txHash?: string;
  contractAddress?: string;
  codeHash?: string;
}

export interface BuilderDeployAdapter {
  deployContract(params: {
    wasm: Uint8Array;
    instantiateMsg: InstantiateMsgPayload;
  }): Promise<DeployResult>;
  getCodeHash?(contractAddress: string): Promise<string>;
}

export interface EstimateCostInput {
  gasUnits?: bigint;
  gasPriceGwei?: number;
  nativePriceUsd?: number;
  fallbackEth?: string;
}

export interface CostEstimate {
  eth: string;
  usd?: string;
}
