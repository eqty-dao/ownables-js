import type { BridgedOwnableRecord, NftRef } from '@ownables/core';

export type AuthorityErrorCode =
  | 'INVALID_ARCHIVE'
  | 'INVALID_CHAIN'
  | 'MISSING_NFT_INFO'
  | 'MISSING_RECORD'
  | 'MISSING_PACKAGE'
  | 'NFT_NOT_LOCKED'
  | 'OWNER_MISMATCH';

export class AuthorityError extends Error {
  constructor(
    public readonly code: AuthorityErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AuthorityError';
  }
}

export interface BridgeOwnableResult extends BridgedOwnableRecord {
  proof: string;
}

export interface OwnableCidLookup {
  ownableCid: string;
  ownableLastOwner: string;
  network: string;
  id: string;
  smartContractAddress: string;
  nftOwner: string;
}

export interface AuthorityServiceLike {
  bridgeOwnableArchive(archive: Uint8Array, signerAddress?: string): Promise<BridgeOwnableResult>;
  getUnlockProof(cid: string, signerAddress?: string): Promise<string>;
  isUnlockProofValid(network: string, address: string, id: string, proof: string): Promise<boolean>;
  getOwnableCidFromNFT(nft: NftRef): Promise<OwnableCidLookup>;
}
