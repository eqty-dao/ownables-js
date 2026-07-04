import type { Binary, ViemSigner } from 'eqty-core';
import type { Chain } from 'viem';

export type TypedDataDomain = Record<string, unknown>;
export type TypedDataField = { name: string; type: string };
export type AnchorTxOptions = { value?: bigint };
export type EmittedPublicEvent = {
  subjectId: string;
  source: string;
  eventType: string;
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  timestamp?: number;
};

export interface AnchorClientLike {
  anchor(payload: Array<{ key: Binary; value: Binary }>, txOptions?: AnchorTxOptions): Promise<string>;
}

export interface PublicEventClientLike {
  emitPublicEvent(
    subjectId: string,
    eventType: string,
    data: Uint8Array,
    txOptions?: AnchorTxOptions
  ): Promise<EmittedPublicEvent>;
}

export interface AnchorFeeReader {
  quoteEqtyCost(count: bigint): Promise<bigint>;
  quoteEthCost(count: bigint): Promise<bigint>;
  eqtyToken(): Promise<string>;
}

export interface EqtyTokenReader {
  allowance(owner: string, spender: string): Promise<bigint>;
  approve?(spender: string, amount: bigint): Promise<string>;
}

export interface ViemAnchorConfig {
  contractAddress: `0x${string}`;
  chain?: Chain;
}

export interface EQTYServiceDeps {
  anchorClient?: AnchorClientLike;
  anchor?: ViemAnchorConfig;
  publicEventClient?: PublicEventClientLike;
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
