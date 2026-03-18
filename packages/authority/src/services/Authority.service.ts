import type {
  ArchiveService,
  BridgedOwnableRecord,
  LockableGateway,
  NftRef,
  RecordStore,
} from '@ownables/core';
import { AuthorityError, type BridgeOwnableResult, type OwnableCidLookup } from '../types/Authority';

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function parseJsonMaybe(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf8');
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

function getEvents(chainJson: Record<string, unknown>): Array<Record<string, unknown>> {
  const events = chainJson.events;
  return Array.isArray(events) ? (events as Array<Record<string, unknown>>) : [];
}

function extractNft(chainJson: Record<string, unknown>): NftRef | undefined {
  const firstEvent = getEvents(chainJson)[0];
  if (!firstEvent) return undefined;

  const parsedData = parseJsonMaybe(firstEvent.parsedData) ?? parseJsonMaybe(firstEvent.data);
  const nft = parsedData?.nft as Partial<NftRef> | undefined;
  if (!nft?.network || !nft.address || !nft.id) return undefined;

  return {
    network: nft.network,
    address: nft.address,
    id: nft.id,
  };
}

function extractPrevOwner(chainJson: Record<string, unknown>, signerAddress?: string): string {
  if (signerAddress) return signerAddress;

  const events = getEvents(chainJson);
  const lastEvent = events[events.length - 1];
  if (!lastEvent) {
    throw new AuthorityError('INVALID_CHAIN', 'Event chain has no events');
  }

  const candidates = [
    lastEvent.signerAddress,
    lastEvent.signer,
    (lastEvent.signKey as Record<string, unknown> | undefined)?.publicKey,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }

  throw new AuthorityError(
    'INVALID_CHAIN',
    'Cannot derive previous owner from chain; signerAddress is required'
  );
}

export interface AuthorityServiceOptions {
  now?: () => Date;
}

export class AuthorityService {
  private readonly now: () => Date;

  constructor(
    private readonly recordStore: RecordStore,
    private readonly archiveService: ArchiveService,
    private readonly lockable: LockableGateway,
    options: AuthorityServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async bridgeOwnableArchive(archive: Uint8Array, signerAddress?: string): Promise<BridgeOwnableResult> {
    const imported = await this.archiveService.importArchive(archive).catch((error) => {
      throw new AuthorityError('INVALID_ARCHIVE', (error as Error).message);
    });

    const nft = extractNft(imported.chainJson);
    if (!nft) {
      throw new AuthorityError('MISSING_NFT_INFO', 'Unable to find nft info in chain genesis event');
    }

    const prevOwner = extractPrevOwner(imported.chainJson, signerAddress);
    const record: BridgedOwnableRecord = {
      cid: imported.cid,
      prevOwner,
      nft,
      createdAt: this.now().toISOString(),
    };

    await this.recordStore.put(record);

    const challenge = await this.lockable.getUnlockChallenge(nft.address, nft.id);
    const proof = await this.lockable.signUnlockChallenge(challenge);

    return { ...record, proof };
  }

  async getUnlockProof(cid: string, signerAddress?: string): Promise<string> {
    const record = await this.recordStore.getByCid(cid);
    if (!record) {
      throw new AuthorityError('MISSING_RECORD', 'CID not found. Ownable copy is not registered.');
    }

    if (!(await this.archiveService.hasPackage(cid))) {
      throw new AuthorityError('MISSING_PACKAGE', 'Ownable package with CID is not available.');
    }

    const locked = await this.lockable.isLocked(record.nft.address, record.nft.id);
    if (!locked) {
      throw new AuthorityError(
        'NFT_NOT_LOCKED',
        `NFT ${record.nft.id} is not locked on ${record.nft.network}:${record.nft.address}`
      );
    }

    if (signerAddress) {
      const owner = await this.lockable.getOwner(record.nft.address, record.nft.id);
      if (normalizeAddress(owner) !== normalizeAddress(signerAddress)) {
        throw new AuthorityError('OWNER_MISMATCH', `Signer ${signerAddress} is not current NFT owner ${owner}`);
      }
    }

    const challenge = await this.lockable.getUnlockChallenge(record.nft.address, record.nft.id);
    return this.lockable.signUnlockChallenge(challenge);
  }

  async isUnlockProofValid(
    _network: string,
    address: string,
    id: string,
    proof: string
  ): Promise<boolean> {
    return this.lockable.isUnlockProofValid(address, id, proof);
  }

  async getOwnableCidFromNFT(nft: NftRef): Promise<OwnableCidLookup> {
    const record = await this.recordStore.getByNft(nft);
    if (!record) {
      throw new AuthorityError('MISSING_RECORD', 'No CID available for nft info');
    }

    const nftOwner = await this.lockable.getOwner(nft.address, nft.id);

    return {
      ownableCid: record.cid,
      ownableLastOwner: record.prevOwner,
      network: nft.network,
      id: nft.id,
      smartContractAddress: nft.address,
      nftOwner,
    };
  }
}

export default AuthorityService;
