import type { TypedPackage } from '@ownables/core';

export interface BucketLike {
  list(): Promise<string[]>;
  get(key: string): Promise<Uint8Array | Buffer | string | undefined>;
  put(key: string, value: Uint8Array | Buffer | string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface NodeSandboxOptions {
  filename?: string;
}

export interface NodePackageAssetIOOptions {
  infoResolver: (nameOrCid: string, uniqueMessageHash?: string) => TypedPackage;
  assetLoader: (cid: string, name: string) => Promise<Uint8Array | Buffer | string>;
  assetList?: (cid: string) => Promise<string[]>;
  zipLoader?: (cid: string) => Promise<unknown>;
}
