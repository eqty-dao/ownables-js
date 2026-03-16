import type { Event, Message } from 'eqty-core';
import type { TypedPackage } from '../types/TypedPackage';
import type { StateDump } from '../services/Ownable.service';

export type LogProgress = (step: string, meta?: Record<string, unknown>) => void;

export interface ProgressReporter {
  step<T>(
    step: string,
    fn: () => Promise<T> | T,
    meta?: () => Record<string, unknown>
  ): Promise<T>;
}

export interface KVStore {
  get(key: string): any;
  set(key: string, value: any): void;
  remove(key: string): void;
  clear(): void;
}

export interface StateStore {
  get(store: string, key: string): Promise<any>;
  getAll(store: string): Promise<Array<any>>;
  getMap(store: string): Promise<Map<any, any>>;
  keys(store: string): Promise<string[]>;
  set(store: string, key: string, value: any): Promise<void>;
  setAll(store: string, map: Record<string, any> | Map<any, any>): Promise<void>;
  setAll(data: Record<string, Record<string, any> | Map<any, any>>): Promise<void>;
  hasStore(store: string): Promise<boolean>;
  createStore(...stores: string[]): Promise<void>;
  deleteStore(store: string | RegExp): Promise<void>;
  listStores(): Promise<string[]>;
  delete(store: string, key: string): Promise<void>;
}

export interface AnchorProvider {
  address: string;
  chainId: number;
  signer: any;
  sign(...subjects: Array<Event | Message>): Promise<void>;
  anchor(...anchors: any[]): Promise<void>;
  submitAnchors(): Promise<string | undefined>;
  verifyAnchors(...anchors: any[]): Promise<{
    verified: boolean;
    anchors: Record<string, string | undefined>;
    map: Record<string, string>;
  }>;
}

export interface PackageAssetIO {
  info(nameOrCid: string, uniqueMessageHash?: string): TypedPackage;
  getAsset(
    cid: string,
    name: string,
    read: (reader: unknown, contents: unknown) => void
  ): Promise<string | ArrayBuffer>;
  getAssetAsText(cid: string, name: string): Promise<string>;
  zip(cid: string): Promise<any>;
}

export interface RuntimeSourceProvider {
  getWorkerPrelude(): string;
}
