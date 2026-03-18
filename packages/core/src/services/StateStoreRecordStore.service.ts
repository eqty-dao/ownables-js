import type { RecordStore, BridgedOwnableRecord, NftRef } from '../types/Authority';
import type { StateStore } from '../interfaces/core';

const STORE_BY_CID = 'records:by-cid';
const STORE_BY_NFT = 'records:index:nft';
const STORE_BY_OWNER = 'records:index:owner';

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function ownerKey(owner: string): string {
  return normalizeAddress(owner);
}

function nftKey(nft: NftRef): string {
  return `${nft.network.toLowerCase()}|${normalizeAddress(nft.address)}|${nft.id}`;
}

async function ensureStores(state: StateStore): Promise<void> {
  const stores = [STORE_BY_CID, STORE_BY_NFT, STORE_BY_OWNER];
  const missing = await Promise.all(stores.map((store) => state.hasStore(store)));

  const toCreate = stores.filter((_store, idx) => !missing[idx]);
  if (toCreate.length > 0) {
    await state.createStore(...toCreate);
  }
}

export default class StateStoreRecordStore implements RecordStore {
  constructor(private readonly state: StateStore) {}

  async put(record: BridgedOwnableRecord): Promise<void> {
    await ensureStores(this.state);

    const existing = await this.getByCid(record.cid);
    const owner = ownerKey(record.prevOwner);
    const nft = nftKey(record.nft);

    await this.state.set(STORE_BY_CID, record.cid, record);
    await this.state.set(STORE_BY_NFT, nft, record.cid);

    const ownerCids = ((await this.state.get(STORE_BY_OWNER, owner)) as string[] | undefined) ?? [];
    if (!ownerCids.includes(record.cid)) {
      await this.state.set(STORE_BY_OWNER, owner, [...ownerCids, record.cid]);
    }

    if (!existing) {
      return;
    }

    const oldOwner = ownerKey(existing.prevOwner);
    const oldNft = nftKey(existing.nft);

    if (oldNft !== nft) {
      await this.state.delete(STORE_BY_NFT, oldNft);
    }

    if (oldOwner !== owner) {
      const oldOwnerCids =
        ((await this.state.get(STORE_BY_OWNER, oldOwner)) as string[] | undefined) ?? [];
      const next = oldOwnerCids.filter((cid) => cid !== record.cid);
      await this.state.set(STORE_BY_OWNER, oldOwner, next);
    }
  }

  async getByCid(cid: string): Promise<BridgedOwnableRecord | undefined> {
    await ensureStores(this.state);
    return (await this.state.get(STORE_BY_CID, cid)) as BridgedOwnableRecord | undefined;
  }

  async hasCid(cid: string): Promise<boolean> {
    const record = await this.getByCid(cid);
    return Boolean(record);
  }

  async getCidByNft(nft: NftRef): Promise<string | undefined> {
    await ensureStores(this.state);
    return (await this.state.get(STORE_BY_NFT, nftKey(nft))) as string | undefined;
  }

  async getByNft(nft: NftRef): Promise<BridgedOwnableRecord | undefined> {
    const cid = await this.getCidByNft(nft);
    if (!cid) return undefined;
    return this.getByCid(cid);
  }

  async listByPrevOwner(prevOwner: string): Promise<BridgedOwnableRecord[]> {
    await ensureStores(this.state);
    const cids =
      ((await this.state.get(STORE_BY_OWNER, ownerKey(prevOwner))) as string[] | undefined) ?? [];

    const records = await Promise.all(cids.map((cid) => this.getByCid(cid)));
    return records.filter((record): record is BridgedOwnableRecord => Boolean(record));
  }
}
