import type { Binary } from 'eqty-core';
import type { Provider, Signer, TypedDataDomain as EthersTypedDataDomain } from 'ethers';

export type TypedDataField = { name: string; type: string };
export type TypedDataDomain = EthersTypedDataDomain;
export type AnchorTxOptions = { value?: bigint };

export interface EthersAnchorClientLike {
  anchor(payload: Array<{ key: Binary; value: Binary }>, txOptions?: AnchorTxOptions): Promise<string>;
}

export interface EthersAnchorFeeContractLike {
  quoteEqtyCost(count: bigint): Promise<bigint>;
  quoteEthCost(count: bigint): Promise<bigint>;
  eqtyToken(): Promise<string>;
}

export interface EthersEqtyTokenLike {
  allowance(owner: string, spender: string): Promise<bigint>;
}

export interface EthersSignerLike {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string>;
}

export interface EQTYServiceDeps {
  anchorClient?: EthersAnchorClientLike;
  feeContract?: EthersAnchorFeeContractLike;
  eqtyToken?: EthersEqtyTokenLike;
  signer?: EthersSignerLike;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  lockableClient?: {
    ownerOf(tokenId: bigint): Promise<string>;
    isLocked(tokenId: bigint): Promise<boolean>;
    unlockChallenge(tokenId: bigint): Promise<string | bigint>;
    isUnlockProofValid(tokenId: bigint, proof: string): Promise<boolean>;
  };
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface EthersAnchorContractLike {
  anchor(
    anchors: Array<{ key: `0x${string}`; value: `0x${string}` }>,
    txOptions?: AnchorTxOptions
  ): Promise<unknown>;
  maxAnchors(): Promise<bigint>;
}

export interface EthersServiceOptions {
  signer?: Signer;
  provider?: Provider;
  ethereumProvider?: EIP1193Provider;
  deps?: EQTYServiceDeps;
}
