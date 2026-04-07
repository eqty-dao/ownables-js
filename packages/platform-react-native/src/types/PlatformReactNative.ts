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
