import type { StateStore } from '@ownables/core';
import type { BucketLike } from '../types/PlatformNode';

const ROOT_PREFIX = 'state-store';
const STORE_MARKER = '__store__.json';

type StoreData = Record<string, unknown> | Map<unknown, unknown>;

function encodeStore(store: string): string {
  return encodeURIComponent(store);
}

function decodeStore(store: string): string {
  return decodeURIComponent(store);
}

function encodeKey(key: unknown): string {
  if (typeof key === 'string') return `s:${encodeURIComponent(key)}`;
  if (ArrayBuffer.isView(key)) {
    const bytes = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
    return `b:${Buffer.from(bytes).toString('base64url')}`;
  }
  if (key instanceof ArrayBuffer) {
    return `b:${Buffer.from(new Uint8Array(key)).toString('base64url')}`;
  }
  if (Array.isArray(key)) {
    return `b:${Buffer.from(Uint8Array.from(key)).toString('base64url')}`;
  }

  return `j:${encodeURIComponent(JSON.stringify(key))}`;
}

function decodeKey(key: string): unknown {
  if (key.startsWith('s:')) return decodeURIComponent(key.slice(2));
  if (key.startsWith('b:')) return Uint8Array.from(Buffer.from(key.slice(2), 'base64url'));
  if (key.startsWith('j:')) return JSON.parse(decodeURIComponent(key.slice(2)));
  return decodeURIComponent(key);
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize(value: Uint8Array | Buffer | string | undefined): unknown {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
  return JSON.parse(text);
}

export default class BucketStateStore implements StateStore {
  constructor(private readonly bucket: BucketLike, private readonly rootPrefix = ROOT_PREFIX) {}

  private markerPath(store: string): string {
    return `${this.rootPrefix}/${encodeStore(store)}/${STORE_MARKER}`;
  }

  private valuePath(store: string, key: unknown): string {
    return `${this.rootPrefix}/${encodeStore(store)}/${encodeKey(key)}.json`;
  }

  private storePrefix(store: string): string {
    return `${this.rootPrefix}/${encodeStore(store)}/`;
  }

  private async allKeys(): Promise<string[]> {
    return this.bucket.list();
  }

  private async ensureStore(store: string): Promise<void> {
    if (!(await this.hasStore(store))) {
      await this.createStore(store);
    }
  }

  async get(store: string, key: string): Promise<unknown> {
    const value = await this.bucket.get(this.valuePath(store, key));
    return deserialize(value);
  }

  async getAll(store: string): Promise<Array<unknown>> {
    const paths = await this.allKeys();
    const prefix = this.storePrefix(store);
    const values = await Promise.all(
      paths
        .filter((path) => path.startsWith(prefix) && !path.endsWith(STORE_MARKER))
        .map((path) => this.bucket.get(path))
    );

    return values
      .map((v) => deserialize(v))
      .filter((v) => v !== undefined);
  }

  async getMap(store: string): Promise<Map<unknown, unknown>> {
    const paths = await this.allKeys();
    const prefix = this.storePrefix(store);
    const map = new Map<unknown, unknown>();

    for (const path of paths) {
      if (!path.startsWith(prefix) || path.endsWith(STORE_MARKER)) continue;
      const encodedWithExt = path.slice(prefix.length);
      const encoded = encodedWithExt.replace(/\.json$/, '');
      const key = decodeKey(encoded);
      const value = deserialize(await this.bucket.get(path));
      if (value !== undefined) {
        map.set(key, value);
      }
    }

    return map;
  }

  async keys(store: string): Promise<string[]> {
    const paths = await this.allKeys();
    const prefix = this.storePrefix(store);

    return paths
      .filter((path) => path.startsWith(prefix) && !path.endsWith(STORE_MARKER))
      .map((path) => decodeKey(path.slice(prefix.length).replace(/\.json$/, '')))
      .filter((key): key is string => typeof key === 'string');
  }

  async set(store: string, key: string, value: unknown): Promise<void> {
    await this.ensureStore(store);
    await this.bucket.put(this.valuePath(store, key), serialize(value));
  }

  async setAll(store: string, map: StoreData): Promise<void>;
  async setAll(data: Record<string, StoreData>): Promise<void>;
  async setAll(a: string | Record<string, StoreData>, b?: StoreData): Promise<void> {
    const data: Record<string, StoreData> =
      typeof a === 'string' && b !== undefined ? { [a]: b } : (a as Record<string, StoreData>);

    for (const [store, map] of Object.entries(data)) {
      await this.ensureStore(store);
      const entries = map instanceof Map ? map.entries() : Object.entries(map);

      for (const [key, value] of entries) {
        await this.bucket.put(this.valuePath(store, key), serialize(value));
      }
    }
  }

  async hasStore(store: string): Promise<boolean> {
    const marker = await this.bucket.get(this.markerPath(store));
    if (marker !== undefined) return true;

    const prefix = this.storePrefix(store);
    const keys = await this.allKeys();
    return keys.some((k) => k.startsWith(prefix));
  }

  async createStore(...stores: string[]): Promise<void> {
    await Promise.all(stores.map((store) => this.bucket.put(this.markerPath(store), '{}')));
  }

  async deleteStore(store: string | RegExp): Promise<void> {
    const stores = await this.listStores();
    const targets = typeof store === 'string' ? [store] : stores.filter((s) => store.test(s));

    for (const target of targets) {
      const prefix = this.storePrefix(target);
      const keys = await this.allKeys();
      await Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => this.bucket.delete(k)));
    }
  }

  async listStores(): Promise<string[]> {
    const keys = await this.allKeys();
    const prefixes = new Set<string>();

    for (const key of keys) {
      if (!key.startsWith(`${this.rootPrefix}/`)) continue;
      const remainder = key.slice(`${this.rootPrefix}/`.length);
      const store = remainder.split('/')[0];
      if (store) {
        prefixes.add(decodeStore(store));
      }
    }

    return Array.from(prefixes.values());
  }

  async delete(store: string, key: string): Promise<void> {
    await this.bucket.delete(this.valuePath(store, key));
  }
}
