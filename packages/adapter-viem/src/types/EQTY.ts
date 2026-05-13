import type { Binary, ViemSigner } from 'eqty-core';

export type TypedDataDomain = Record<string, unknown>;
export type TypedDataField = { name: string; type: string };
export type AnchorTxOptions = { value?: bigint };

export interface AnchorClientLike {
  anchor(payload: Array<{ key: Binary; value: Binary }>, txOptions?: AnchorTxOptions): Promise<string>;
}

export interface AnchorFeeReader {
  quoteEqtyCost(count: bigint): Promise<bigint>;
  quoteEthCost(count: bigint): Promise<bigint>;
  eqtyToken(): Promise<string>;
}

export interface EqtyTokenReader {
  allowance(owner: string, spender: string): Promise<bigint>;
}

export interface EQTYServiceDeps {
  anchorClient?: AnchorClientLike;
  feeReader?: AnchorFeeReader;
  eqtyToken?: EqtyTokenReader;
  signer?: ViemSigner;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  lockableClient?: {
    ownerOf(tokenId: bigint): Promise<string>;
    isLocked(tokenId: bigint): Promise<boolean>;
    unlockChallenge(tokenId: bigint): Promise<string | bigint>;
    isUnlockProofValid(tokenId: bigint, proof: string): Promise<boolean>;
  };
}
