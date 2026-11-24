import LocalStorageService from './LocalStorage.service.js';
import type {
  TypedPackageCapabilities,
  TypedPackage,
  TypedPackageStub,
} from '@ownables/core/types/TypedPackage';
import type { TypedCosmWasmMsg } from '@ownables/core/types/TypedCosmWasmMsg';
import type TypedDict from '@ownables/core/types/TypedDict';
import type { MessageExt } from '@ownables/core/types/MessageInfo';
import JSZip from 'jszip';
import mime from 'mime/lite';
import IDBService from './IDB.service.js';
import { RelayService } from './Relay.service.js';
import { Buffer } from 'buffer';
import { EventChain, type IEventChainJSON } from 'eqty-core';
import {
  assertAttachmentCid,
  calculateOwnablePackageCid,
  collectOwnableAttachments,
  OWNABLE_ATTACHMENT_PREFIX,
  readOwnableBundleArchive,
} from '@ownables/core/utils';

const getMimeType = (filename: string): string | null | undefined =>
  (mime as any)?.getType?.(filename);

const PACKAGE_ASSET_STORE = 'package-assets';
const ATTACHMENT_PREFIX = 'attachment:';

const isAttachmentPath = (name: string): boolean => {
  const path = name.replaceAll('\\', '/').replace(/^\.?\//, '');
  return path === 'attachments' || path.startsWith(OWNABLE_ATTACHMENT_PREFIX);
};

const isChainPath = (name: string): boolean => name === 'chain.json' || name === 'eventChain.json';

const fileFromBytes = (name: string, bytes: Uint8Array): File =>
  new File([Uint8Array.from(bytes)], name, {
    type: getMimeType(name) || 'application/octet-stream',
  });

type ComparableChain = {
  id: string;
  events: readonly { hash?: string | { hex: string }; state?: string }[];
};

const capabilitiesStaticOwnable = {
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  hasAttachments: false,
  isClosable: false,
  isConsumable: false,
  isConsumer: false,
  isLockable: false,
  isTransferable: false,
};

const isInternalPackage = (pkg: TypedPackage | TypedPackageStub): boolean =>
  Array.isArray(pkg.keywords) && pkg.keywords.includes('internal');

export default class PackageService {
  private readonly exampleUrl: string | undefined;
  private readonly examples: TypedPackageStub[];
  private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly fileReaderFactory: () => FileReader;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  private readonly legacyIdb: IDBService | undefined;

  constructor(
    private idb: IDBService,
    private relay: RelayService,
    private localStorage: LocalStorageService,
    options: {
      exampleUrl?: string;
      examples?: TypedPackageStub[];
      fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
      fileReaderFactory?: () => FileReader;
      logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
      legacyIdb?: IDBService;
    } = {}
  ) {
    this.exampleUrl = options.exampleUrl;
    this.examples = options.examples ?? [];
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.fileReaderFactory = options.fileReaderFactory ?? (() => new FileReader());
    this.logger = options.logger ?? console;
    this.legacyIdb = options.legacyIdb;
  }

  list(): Array<TypedPackage | TypedPackageStub> {
    const local = (this.localStorage.get('packages') || []) as TypedPackage[];
    for (const pkg of local) {
      pkg.versions = pkg.versions.map(({ date, cid }: { date: Date | string; cid: string }) => ({
        date: new Date(date),
        cid,
      }));
    }

    const set = new Map([...this.examples, ...local].map((pkg) => [pkg.name, pkg])).values();

    return Array.from(set)
      .filter((pkg) => !isInternalPackage(pkg))
      .sort((a, b) => (a.title >= b.title ? 1 : -1));
  }

  info(nameOrCid: string, uniqueMessageHash?: string): TypedPackage {
    const found = this.maybeInfo(nameOrCid, uniqueMessageHash);

    if (!found) throw new Error(`Package not found: ${nameOrCid}`);
    return found;
  }

  maybeInfo(nameOrCid: string, uniqueMessageHash?: string): TypedPackage | undefined {
    const packages = (this.localStorage.get('packages') || []) as TypedPackage[];

    return packages.find(
      (pkg) =>
        (pkg.name === nameOrCid ||
          pkg.versions.some((v: { cid: string }) => v.cid === nameOrCid)) &&
        (!uniqueMessageHash ||
          pkg.versions.some(
            (v: { uniqueMessageHash?: string }) => v.uniqueMessageHash === uniqueMessageHash
          ))
    );
  }

  private storePackageInfo(
    title: string,
    name: string,
    version: string | undefined,
    ownablesAbi: string | undefined,
    wireFormat: string | undefined,
    description: string | undefined,
    cid: string,
    keywords: string[],
    capabilities: TypedPackageCapabilities,
    isNotLocal?: boolean,
    uniqueMessageHash?: string
  ): TypedPackage {
    const packages = (this.localStorage.get('packages') || []) as TypedPackage[];

    // Locate the package with matching cid and uniqueMessageHash
    let pkg = packages.find(
      (pkg) => pkg.name === name && pkg.cid === cid && pkg.uniqueMessageHash === uniqueMessageHash
    );

    if (!pkg) {
      const versionEntry = uniqueMessageHash
        ? { date: new Date(), cid, uniqueMessageHash }
        : { date: new Date(), cid };
      // Create new package entry if not found
      const createdPkg: TypedPackage = {
        title,
        name,
        cid,
        keywords,
        ...capabilities,
        ...(version ? { version } : {}),
        ...(ownablesAbi ? { ownablesAbi } : {}),
        ...(wireFormat ? { wireFormat } : {}),
        ...(description ? { description } : {}),
        ...(isNotLocal ? { isNotLocal } : {}),
        ...(uniqueMessageHash ? { uniqueMessageHash } : {}),
        versions: [versionEntry],
      };
      pkg = createdPkg;
      packages.push(createdPkg);
    } else {
      // Update package and add new version info if it's an update
      Object.assign(pkg, {
        keywords,
        ...(version ? { version } : {}),
        ...(ownablesAbi ? { ownablesAbi } : {}),
        ...(wireFormat ? { wireFormat } : {}),
        ...(description ? { description } : {}),
        ...(uniqueMessageHash ? { uniqueMessageHash } : {}),
        ...capabilities,
      });
      const versionEntry = uniqueMessageHash
        ? { date: new Date(), cid, uniqueMessageHash }
        : { date: new Date(), cid };
      pkg.versions.push(versionEntry);
    }

    // Save all packages back to LocalStorage under the single "packages" key
    this.localStorage.set('packages', packages);

    if (!pkg) throw new Error('Failed to create package entry');
    return pkg;
  }

  async extractAssets(zipFile: File, chain?: boolean): Promise<File[]> {
    const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());

    return await Promise.all(
      Object.entries(zip.files)
        .filter(
          ([filename]) =>
            !filename.startsWith('.') &&
            !isAttachmentPath(filename) &&
            (chain || !isChainPath(filename))
        )
        .map(async ([filename, file]) => {
          const blob = await file.async('blob');
          const type = getMimeType(filename) || 'application/octet-stream';
          return new File([blob], filename, { type });
        })
    );
  }

  private async storeAssets(
    cid: string,
    files: File[],
    attachments: ReadonlyMap<string, Uint8Array> = new Map()
  ): Promise<void> {
    const storeName = PACKAGE_ASSET_STORE;

    try {
      if (!(await this.idb.hasStore(storeName))) {
        await this.idb.createStore(storeName);
      }

      const entries = Object.fromEntries(
        files.map((file) => [this.assetKey(cid, file.name), file])
      );
      for (const [attachmentCid, bytes] of attachments) {
        entries[this.attachmentKey(attachmentCid)] = fileFromBytes(attachmentCid, bytes);
      }
      await this.idb.setAll(storeName, entries);

      // Verify store exists and has data
      await this.verifyPackageAssets(cid, files.length);
    } catch (error) {
      // Check for quota errors
      if (error instanceof Error) {
        if (
          error.name === 'QuotaExceededError' ||
          error.message?.includes('quota') ||
          error.message?.includes('QuotaExceeded')
        ) {
          throw new Error(
            `Device storage quota exceeded. Please free up space on your device and try again.`
          );
        }
      }
      throw error;
    }
  }

  private assetPrefix(cid: string): string {
    return `${cid}:`;
  }

  private assetKey(cid: string, filename: string): string {
    return `${this.assetPrefix(cid)}${filename}`;
  }

  private attachmentKey(cid: string): string {
    return `${ATTACHMENT_PREFIX}${cid}`;
  }

  private async hasPackageAssets(cid: string): Promise<boolean> {
    if (await this.idb.hasStore(PACKAGE_ASSET_STORE)) {
      const keys = await this.idb.keysByPrefix(PACKAGE_ASSET_STORE, this.assetPrefix(cid));
      if (keys.length > 0) {
        return true;
      }
    }

    return this.legacyIdb ? this.legacyIdb.hasStore(`package:${cid}`) : false;
  }

  private async verifyPackageAssets(cid: string, expectedFileCount: number): Promise<void> {
    try {
      const keys = await this.idb.keysByPrefix(PACKAGE_ASSET_STORE, this.assetPrefix(cid));
      if (keys.length < expectedFileCount) {
        throw new Error(
          `Store verification failed: expected ${expectedFileCount} files, found ${keys.length}`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new Error(`Device storage quota exceeded. Please free up space and try again.`);
      }
      throw error;
    }
  }

  private async retryPackageVerification(
    cid: string,
    expectedFileCount: number,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.verifyPackageAssets(cid, expectedFileCount);
        return;
      } catch (error) {
        this.logger.warn(`Store verification attempt ${attempt}/${maxRetries} failed:`, error);

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        } else {
          throw error;
        }
      }
    }
  }

  private async verifyStoreExists(storeName: string, expectedFileCount: number): Promise<void> {
    const hasStore = await this.idb.hasStore(storeName);
    if (!hasStore) {
      throw new Error(`Store ${storeName} was not created successfully`);
    }

    // Verify data was written
    try {
      const keys = await this.idb.keys(storeName);
      if (keys.length < expectedFileCount) {
        throw new Error(
          `Store verification failed: expected ${expectedFileCount} files, found ${keys.length}`
        );
      }
    } catch (error) {
      // Check if it's a quota error
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new Error(`Device storage quota exceeded. Please free up space and try again.`);
      }
      throw error;
    }
  }

  private async retryStoreVerification(
    storeName: string,
    expectedFileCount: number,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.verifyStoreExists(storeName, expectedFileCount);
        return; // Success
      } catch (error) {
        this.logger.warn(`Store verification attempt ${attempt}/${maxRetries} failed:`, error);

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        } else {
          // Last attempt failed
          throw error;
        }
      }
    }
  }

  base64ToBuffer(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }

  bufferToString(buffer: Buffer): string {
    return buffer.toString('utf8');
  }

  async getChainJson(filename: string, files: any): Promise<any> {
    const extractedFile = await this.extractAssets(files, true);
    const file = extractedFile.find((file: any) => file.name === filename);
    if (!file) throw new Error(`Invalid package: missing ${filename}`);

    const fileContent = await file.text();
    const json = JSON.parse(fileContent);

    json.events = json.events.map((event: MessageExt) => {
      if (event.data?.startsWith('base64:')) {
        const base64Data = event.data.slice(7);
        const bufferData = this.base64ToBuffer(base64Data);
        event.parsedData = JSON.parse(this.bufferToString(bufferData));
      }
      return event;
    });

    return json;
  }

  private async getPackageJson(filename: string, files: File[]): Promise<any> {
    const file = files.find((file) => file.name === filename);
    if (!file) throw new Error(`Invalid package: missing ${filename}`);
    return JSON.parse(await file.text());
  }

  private async getCapabilities(files: File[]): Promise<TypedPackageCapabilities> {
    if (files.findIndex((file) => file.name === 'package.json') < 0)
      throw new Error('Invalid package: missing package.json');

    if (files.findIndex((file) => file.name === 'ownable_bg.wasm') < 0)
      return capabilitiesStaticOwnable;

    const query: TypedCosmWasmMsg = await this.getPackageJson('query_msg.json', files);
    const execute: TypedCosmWasmMsg = await this.getPackageJson('execute_msg.json', files);

    const hasMethod = (schema: TypedCosmWasmMsg, find: string) =>
      schema.oneOf.findIndex((method: { required: string[] }) => method.required.includes(find)) >=
      0;

    if (!hasMethod(query, 'get_info'))
      throw new Error('Invalid package: missing `get_info` query method');

    return {
      isDynamic: true,
      hasMetadata: hasMethod(query, 'get_metadata'),
      hasWidgetState: hasMethod(query, 'get_widget_state'),
      hasAttachments: hasMethod(query, 'get_attachments') && hasMethod(execute, 'attach'),
      isClosable: hasMethod(query, 'is_closed') && hasMethod(execute, 'close'),
      isConsumable: hasMethod(execute, 'consume'),
      isConsumer: hasMethod(query, 'is_consumer_of'),
      isLockable: hasMethod(execute, 'lock'),
      isTransferable: hasMethod(execute, 'transfer'),
    };
  }

  private validatePackageFormat(packageJson: TypedDict, files: File[]): void {
    const hasWasm = files.some((file) => file.name === 'ownable_bg.wasm');
    if (!hasWasm) return;

    const ownablesAbi = packageJson.ownablesAbi;
    const wireFormat = packageJson.wireFormat;

    if (ownablesAbi !== '1') {
      throw new Error(
        `Invalid package: expected package.json ownablesAbi to be "1", got "${String(ownablesAbi)}"`
      );
    }

    if (wireFormat !== 'cbor') {
      throw new Error(
        `Invalid package: expected package.json wireFormat to be "cbor", got "${String(wireFormat)}"`
      );
    }
  }

  private async readOwnableArchive(input: File | Uint8Array | ArrayBuffer) {
    const { assets, chain, attachments } = await readOwnableBundleArchive(input);

    return {
      files: Array.from(assets, ([name, bytes]) => fileFromBytes(name, bytes)),
      chainJson: chain
        ? (JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chain)) as IEventChainJSON)
        : undefined,
      attachments,
    };
  }

  async processPackage(message: any, uniqueMessageHash?: string, isNotLocal = false) {
    if (!isNotLocal) return this.finalizeImportedPackage(message, undefined, uniqueMessageHash);

    const data = message.data;
    const { files, chainJson, attachments } = await this.readOwnableArchive(
      data instanceof Uint8Array ? data : data.buffer
    );
    if (!chainJson) throw new Error('Missing chain.json for relay package');
    return this.finalizeImportedPackage(files, { chainJson, attachments }, uniqueMessageHash);
  }

  async importFromHub(packageZipFile: File, chainJson: unknown): Promise<TypedPackage> {
    const { files, attachments } = await this.readOwnableArchive(packageZipFile);
    if (!chainJson) throw new Error('Hub notification package did not include chain state');
    const pkg = await this.finalizeImportedPackage(files, {
      chainJson: chainJson as IEventChainJSON,
      attachments,
    });

    if (!pkg?.chain) {
      throw new Error('Hub notification package did not include chain state');
    }

    return pkg;
  }

  async importOwnable(zipFile: File): Promise<TypedPackage> {
    const { files, chainJson, attachments } = await this.readOwnableArchive(zipFile);
    if (!chainJson) throw new Error('Invalid package: missing chain.json');
    const genesis = chainJson.events?.[0];
    if (!genesis || !('signature' in genesis) || !genesis.signature) {
      throw new Error('Ownable archive must include a signed genesis event');
    }

    const pkg = await this.finalizeImportedPackage(files, {
      chainJson,
      attachments,
      acceptSameHead: true,
    });
    if (!pkg?.chain)
      throw new Error('The incoming Ownable chain is older than or conflicts with the local chain');
    return pkg;
  }

  private async finalizeImportedPackage(
    importedFiles: File[],
    bundle?: {
      chainJson: IEventChainJSON;
      attachments: ReadonlyMap<string, Uint8Array>;
      acceptSameHead?: boolean;
    },
    uniqueMessageHash?: string
  ) {
    const files = importedFiles.filter(
      (file) => !isAttachmentPath(file.name) && !isChainPath(file.name)
    );
    const packageJson: TypedDict = await this.getPackageJson('package.json', files);

    if (!packageJson) {
      throw new Error('Missing package.json in extracted assets');
    }
    const cid = await calculateOwnablePackageCid(
      await Promise.all(
        files.map(async (file) => ({
          path: file.name,
          content: new Uint8Array(await file.arrayBuffer()),
        }))
      )
    );

    if (bundle && !(await this.isCurrentEvent(bundle.chainJson, bundle.acceptSameHead))) {
      this.logger.warn(`Package with CID ${cid} contains a duplicate, older or conflicting chain.`);
      return null;
    }

    const name = packageJson.name || 'Unnamed Package';
    const title = name
      .replace(/^ownable-|-ownable$/, '')
      .replace(/[-_]+/, ' ')
      .replace(/\b\w/, (c: string) => c.toUpperCase());
    const description = packageJson.description;
    const version = packageJson.version;
    const ownablesAbi = packageJson.ownablesAbi;
    const wireFormat = packageJson.wireFormat;
    const keywords: string[] = packageJson.keywords || [];
    this.validatePackageFormat(packageJson, files);
    const capabilities = await this.getCapabilities(files);

    let chain: EventChain | undefined;
    let attachments: ReadonlyMap<string, Uint8Array> | undefined;
    if (bundle) {
      chain = EventChain.from({ ...bundle.chainJson, events: [...bundle.chainJson.events] });
      attachments = await collectOwnableAttachments(chain, async (attachmentCid) =>
        bundle.attachments.get(attachmentCid)
      );
      for (const [attachmentCid, bytes] of bundle.attachments) {
        if (attachments.get(attachmentCid) !== bytes)
          await assertAttachmentCid(attachmentCid, bytes);
      }
      for (const event of chain.events) event.attachments.length = 0;
    }

    await this.storeAssets(cid, files, attachments);

    //Store package info
    const pkg = this.storePackageInfo(
      title,
      name,
      version,
      ownablesAbi,
      wireFormat,
      description,
      cid,
      keywords,
      capabilities,
      bundle !== undefined,
      uniqueMessageHash
    );

    //Attach chain if needed
    if (chain) pkg.chain = chain;

    return pkg;
  }

  async import(zipFile: File): Promise<TypedPackage> {
    const files = await this.extractAssets(zipFile);
    const pkg = await this.processPackage(files);

    if (!pkg) {
      throw new Error('Failed to process package: duplicate or invalid package.');
    }

    // Verify store exists after import
    const hasStore = await this.hasPackageAssets(pkg.cid);

    if (!hasStore) {
      // Retry verification in background (non-blocking)
      this.retryPackageVerification(pkg.cid, files.length, 3, 1000).catch((error) => {
        this.logger.error(`Background store verification failed after retries:`, error);
        // Optionally notify user or log to error tracking service
      });

      // Still return the package even if verification is pending
      // The background retry will handle it
    } else {
      // Store exists, verify data integrity
      try {
        await this.verifyPackageAssets(pkg.cid, files.length);
      } catch (error) {
        // If verification fails, start background retry
        this.logger.warn(`Initial store verification failed, retrying in background:`, error);
        this.retryPackageVerification(pkg.cid, files.length, 3, 1000).catch((retryError) => {
          this.logger.error(`Background store verification failed after retries:`, retryError);
        });
      }
    }

    return pkg;
  }

  async importFromRelay(): Promise<[TypedPackage[], boolean] | null> {
    try {
      const relayData = await this.relay.readAll();

      if (!relayData || !Array.isArray(relayData) || relayData.length === 0) {
        return null;
      }

      // Filter out null values and transform to MessageExt format
      const validMessages = relayData
        .filter(
          (data): data is { message: any; hash: string } =>
            data !== null && data.message && data.hash
        )
        .map((data) => ({
          hash: data.hash,
          recipient: data.message.recipient || '',
          sender: data.message.sender || {},
          size: data.message.data?.length || 0,
          timestamp: new Date(data.message.timestamp || Date.now()),
          type: data.message.meta?.type || 'basic',
          data: data.message.data,
          signature: data.message.signature,
          _hash: data.message.hash,
          parsedData: data.message.parsedData || '',
          messageHash: data.hash,
          message: data.message,
        }));

      if (validMessages.length === 0) {
        return null;
      }

      const filteredMessages = await this.relay.checkDuplicateMessage(validMessages);

      let triggerRefresh = false;

      const results = await Promise.all(
        filteredMessages.map(async (data: any) => {
          try {
            const { message, messageHash } = data;
            const pkg = await this.processPackage(message, messageHash, true);

            if (!pkg) return;

            if (await this.hasPackageAssets(pkg.cid)) {
              triggerRefresh = true;
            }

            return pkg;
          } catch (err) {
            this.logger.error('Error processing data:', err);
            return null;
          }
        })
      );

      const packages = results.filter(
        (pkg: TypedPackage | null | undefined): pkg is TypedPackage =>
          pkg !== null && pkg !== undefined
      );
      return [packages, triggerRefresh];
    } catch (error) {
      this.logger.error('Error:', error);
      return null;
    }
  }

  async isCurrentEvent(chain: ComparableChain, acceptSameHead = false): Promise<boolean> {
    const store = `ownable:${chain.id}`;
    if (!(await this.idb.hasStore(store))) return true;

    const existing = (await this.idb.get(store, 'chain')) as IEventChainJSON | undefined;
    if (!existing?.events) return true;
    if (
      existing.events.length === 0 ||
      chain.events.length < existing.events.length ||
      (!acceptSameHead && chain.events.length === existing.events.length)
    ) {
      return false;
    }

    return existing.events.every((event, index) => {
      const incoming = chain.events[index];
      if (!incoming) return false;
      const incomingHash = typeof incoming.hash === 'string' ? incoming.hash : incoming.hash?.hex;
      const storedState = 'state' in event ? event.state : undefined;
      return (
        event.hash !== undefined && incomingHash === event.hash && incoming.state === storedState
      );
    });
  }

  async downloadExample(key: string): Promise<TypedPackage> {
    if (!this.exampleUrl) throw new Error('Unable to download example ownable: URL not configured');

    const filename = key.replace(/^ownable-/, '') + '.zip';

    const response = await this.fetchFn(`${this.exampleUrl}/${filename}`);
    if (!response.ok) throw new Error(`Failed to download example ownable: ${response.statusText}`);

    const contentType = response.headers.get('Content-Type')?.trim();
    if (contentType !== 'application/zip' && contentType !== 'application/x-zip-compressed')
      throw new Error('Failed to download example ownable: invalid content type');

    const zipFile = new File([await response.blob()], `${key}.zip`, {
      type: 'application/zip',
    });

    return this.import(zipFile);
  }

  async getAsset(
    cid: string,
    name: string,
    read: (fr: FileReader, contents: Blob | File) => void
  ): Promise<string | ArrayBuffer> {
    if (isAttachmentPath(name)) {
      return Promise.reject(`Asset "${name}" is not in package ${cid}`);
    }

    return new Promise((resolve, reject) => {
      const fileReader = this.fileReaderFactory();
      void (async () => {
        if (await this.idb.hasStore(PACKAGE_ASSET_STORE)) {
          const mediaFile = await this.idb.get(PACKAGE_ASSET_STORE, this.assetKey(cid, name));

          if (mediaFile) {
            fileReader.onload = (event) => {
              const result = event.target?.result;
              if (result === null || result === undefined) {
                reject(new Error(`Failed to read asset "${name}" from package ${cid}`));
                return;
              }
              resolve(result);
            };

            read(fileReader, mediaFile);
            return;
          }
        }

        if (this.legacyIdb && (await this.legacyIdb.hasStore(`package:${cid}`))) {
          const legacyFile = await this.legacyIdb.get(`package:${cid}`, name);
          if (legacyFile) {
            fileReader.onload = (event) => {
              const result = event.target?.result;
              if (result === null || result === undefined) {
                reject(new Error(`Failed to read asset "${name}" from package ${cid}`));
                return;
              }
              resolve(result);
            };

            read(fileReader, legacyFile);
            return;
          }
        }

        reject(`Asset "${name}" is not in package ${cid}`);
      })().catch((error) => reject(error));
    });
  }

  getAssetAsText(cid: string, name: string): Promise<string> {
    const read = (fr: FileReader, mediaFile: Blob | File) => fr.readAsText(mediaFile);
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  getAssetAsDataUri(cid: string, name: string): Promise<string> {
    const read = (fr: FileReader, mediaFile: Blob | File) => fr.readAsDataURL(mediaFile);
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  async storeAttachment(cid: string, file: File): Promise<void> {
    if (!(await this.idb.hasStore(PACKAGE_ASSET_STORE))) {
      await this.idb.createStore(PACKAGE_ASSET_STORE);
    }

    await this.idb.set(PACKAGE_ASSET_STORE, this.attachmentKey(cid), file);
  }

  async getAttachment(cid: string): Promise<File> {
    const file = await this.findAttachment(cid);
    if (!file) {
      throw new Error(`Attachment ${cid} is not stored locally`);
    }
    return file;
  }

  async findAttachment(cid: string): Promise<File | undefined> {
    if (!(await this.idb.hasStore(PACKAGE_ASSET_STORE))) return undefined;
    return (await this.idb.get(PACKAGE_ASSET_STORE, this.attachmentKey(cid))) ?? undefined;
  }

  async zip(cid: string): Promise<JSZip> {
    const zip = new JSZip();
    const files = (await this.idb.hasStore(PACKAGE_ASSET_STORE))
      ? await this.idb.getAllByPrefix(PACKAGE_ASSET_STORE, this.assetPrefix(cid))
      : [];

    const packageFiles =
      files.length > 0
        ? files
        : this.legacyIdb && (await this.legacyIdb.hasStore(`package:${cid}`))
          ? await this.legacyIdb.getAll(`package:${cid}`)
          : [];

    for (const file of packageFiles) {
      if (!isAttachmentPath(file.name) && !isChainPath(file.name)) {
        zip.file(file.name, await file.arrayBuffer());
      }
    }
    return zip;
  }
}
