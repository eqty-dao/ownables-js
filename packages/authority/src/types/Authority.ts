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

/** @deprecated Result of the Lockable NFT bridge; do not create new bridges. */
export interface BridgeOwnableResult extends BridgedOwnableRecord {
  proof: string;
}

/** @deprecated Lookup result for a historical Lockable NFT bridge. */
export interface OwnableCidLookup {
  ownableCid: string;
  ownableLastOwner: string;
  network: string;
  id: string;
  smartContractAddress: string;
  nftOwner: string;
}

/** @deprecated Lockable NFT bridge contract; existing unlock access remains operational pending recovery. */
export interface AuthorityServiceLike {
  /** @deprecated Use public events and ordinary Ownable upload for new integrations. */
  bridgeOwnableArchive(archive: Uint8Array, signerAddress?: string): Promise<BridgeOwnableResult>;
  /** @deprecated Retain for existing locks until a verified recovery route is available. */
  getUnlockProof(cid: string, signerAddress?: string): Promise<string>;
  /** @deprecated Lockable NFT proof validation remains operational pending recovery. */
  isUnlockProofValid(network: string, address: string, id: string, proof: string): Promise<boolean>;
  /** @deprecated Historical Lockable NFT bridge lookup; use ordinary Ownable verification. */
  getOwnableCidFromNFT(nft: NftRef): Promise<OwnableCidLookup>;
}
