import type { Binary, ViemSigner } from 'eqty-core';

export type TypedDataDomain = Record<string, unknown>;
export type TypedDataField = { name: string; type: string };

export interface EQTYServiceDeps {
  anchorClient?: { anchor(payload: Array<{ key: Binary; value: Binary }>): Promise<string> };
  signer?: ViemSigner;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  lockableClient?: {
    ownerOf(tokenId: bigint): Promise<string>;
    isLocked(tokenId: bigint): Promise<boolean>;
    unlockChallenge(tokenId: bigint): Promise<string | bigint>;
    isUnlockProofValid(tokenId: bigint, proof: string): Promise<boolean>;
  };
}
