import type { TypedPackage } from '@ownables/core';

export type RNAbiCallType = 'instantiate' | 'execute' | 'query' | 'external_event';

export interface RNRuntimeBridge {
  createInstance(id: string): Promise<string> | string;
  loadWasm(instanceId: string, wasm: Uint8Array): Promise<void> | void;
  call(instanceId: string, type: RNAbiCallType, payload: Uint8Array): Promise<Uint8Array> | Uint8Array;
  disposeInstance(instanceId: string): Promise<void> | void;
}

export interface RNOwnableRPCOptions {
  bridge: RNRuntimeBridge;
}

export interface RNRuntimeRpcProviderOptions {
  bridge: RNRuntimeBridge;
}

export interface RNStateStoreBackend {
  list(): Promise<string[]>;
  get(key: string): Promise<Uint8Array | string | undefined>;
  put(key: string, value: Uint8Array | string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RNStateStoreOptions {
  backend: RNStateStoreBackend;
  rootPrefix?: string;
}

export interface RNPackageFileSystem {
  readFile(path: string): Promise<Uint8Array | ArrayBuffer | string | undefined>;
  listFiles(prefix: string): Promise<string[]>;
}

export interface RNPackageAssetIOOptions {
  infoResolver: (nameOrCid: string, uniqueMessageHash?: string) => TypedPackage;
  fileSystem: RNPackageFileSystem;
  packageRoot?: string;
  zipLoader?: (cid: string) => Promise<unknown>;
}

export interface RNRuntimeSourceProviderOptions {
  workerSource?: string;
}

export interface RNOwnableRecord {
  id: string;
  packageCid: string;
  stateHex: string;
  latestHash: string;
  createdAt: number;
  uniqueMessageHash?: string;
  isConsumed?: boolean;
}

export interface RNStoredEventRecord {
  ownableId: string;
  eventIndex: number;
  eventHash: string;
  previousHash?: string;
  eventBin: Uint8Array;
  timestampMs?: number;
  signerAddress?: string;
  mediaType: string;
}

export interface RNOwnableStateEntry {
  ownableId: string;
  keyBlob: Uint8Array;
  valueBlob: Uint8Array;
}

export interface RNOwnableSnapshotRecord {
  ownableId: string;
  eventIndex: number;
  blockHash: string;
  stateBlob: Uint8Array;
  createdAt: number;
}

export interface RNOwnableAttachmentRef {
  ownableId: string;
  eventIndex: number;
  ordinal: number;
  attachmentName: string;
  mediaType: string;
  cid: string;
}

export interface RNAttachmentBlobRecord {
  cid: string;
  sizeBytes: number;
  mediaType: string;
  refCount: number;
  createdAt: number;
}

export type RNCidCalculator = (bytes: Uint8Array) => Promise<string> | string;

export interface RNAttachmentBlobStore {
  has(cid: string): Promise<boolean>;
  read(cid: string): Promise<Uint8Array | undefined>;
  write(cid: string, bytes: Uint8Array): Promise<void>;
  delete(cid: string): Promise<void>;
}

export interface RNOwnablePersistenceBackend {
  upsertOwnable(record: RNOwnableRecord): Promise<void>;
  getOwnable(id: string): Promise<RNOwnableRecord | undefined>;

  putEvent(record: RNStoredEventRecord): Promise<void>;
  listEvents(ownableId: string): Promise<RNStoredEventRecord[]>;

  replaceStateEntries(ownableId: string, entries: RNOwnableStateEntry[]): Promise<void>;
  listStateEntries(ownableId: string): Promise<RNOwnableStateEntry[]>;

  putSnapshot(snapshot: RNOwnableSnapshotRecord): Promise<void>;
  listSnapshots(ownableId: string): Promise<RNOwnableSnapshotRecord[]>;
  deleteSnapshots(ownableId: string, eventIndexes: number[]): Promise<void>;

  putEventAttachmentRefs(
    ownableId: string,
    eventIndex: number,
    refs: RNOwnableAttachmentRef[]
  ): Promise<void>;
  listEventAttachmentRefs(ownableId: string, eventIndex: number): Promise<RNOwnableAttachmentRef[]>;
  listAttachmentRefsForOwnable(ownableId: string): Promise<RNOwnableAttachmentRef[]>;

  upsertAttachmentBlob(record: RNAttachmentBlobRecord): Promise<void>;
  getAttachmentBlob(cid: string): Promise<RNAttachmentBlobRecord | undefined>;
  updateAttachmentBlobRefCount(cid: string, delta: number): Promise<RNAttachmentBlobRecord | undefined>;
  deleteAttachmentBlob(cid: string): Promise<void>;

  deleteOwnable(ownableId: string): Promise<void>;
}
