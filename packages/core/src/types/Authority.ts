export interface NftRef {
  network: string;
  address: string;
  id: string;
}

export interface BridgedOwnableRecord {
  cid: string;
  prevOwner: string;
  nft: NftRef;
  createdAt: string;
}

export interface ImportedArchive {
  cid: string;
  chainJson: Record<string, unknown>;
  chainFileName: 'eventChain.json' | 'chain.json';
  packageFiles: string[];
}

export interface RecordStore {
  put(record: BridgedOwnableRecord): Promise<void>;
  getByCid(cid: string): Promise<BridgedOwnableRecord | undefined>;
  hasCid(cid: string): Promise<boolean>;
  getCidByNft(nft: NftRef): Promise<string | undefined>;
  getByNft(nft: NftRef): Promise<BridgedOwnableRecord | undefined>;
  listByPrevOwner(prevOwner: string): Promise<BridgedOwnableRecord[]>;
}

export interface ArchiveService {
  importArchive(data: Uint8Array): Promise<ImportedArchive>;
  hasPackage(cid: string): Promise<boolean>;
  hasChain(cid: string): Promise<boolean>;
  readChain(cid: string): Promise<Record<string, unknown>>;
  readPackageZip(cid: string): Promise<Uint8Array>;
}

export interface LockableGateway {
  getOwner(contractAddress: string, tokenId: string): Promise<string>;
  isLocked(contractAddress: string, tokenId: string): Promise<boolean>;
  getUnlockChallenge(contractAddress: string, tokenId: string): Promise<string>;
  signUnlockChallenge(challenge: string): Promise<string>;
  isUnlockProofValid(contractAddress: string, tokenId: string, proof: string): Promise<boolean>;
}
