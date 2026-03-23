import LocalStorageService from "./LocalStorage.service";
import type { TypedPackageCapabilities, TypedPackage, TypedPackageStub } from "@ownables/core/types/TypedPackage";
import type { TypedCosmWasmMsg } from "@ownables/core/types/TypedCosmWasmMsg";
import type TypedDict from "@ownables/core/types/TypedDict";
import type { MessageExt } from "@ownables/core/types/MessageInfo";
import JSZip from "jszip";
import mime from "mime/lite";
import IDBService from "./IDB.service";
import calculateCid from "../utils/calculateCid";
import { RelayService } from "./Relay.service";
import { Buffer } from "buffer";
import { EventChain } from "eqty-core";

const getMimeType = (filename: string): string | null | undefined =>
  (mime as any)?.getType?.(filename);

const capabilitiesStaticOwnable = {
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  isConsumable: false,
  isConsumer: false,
  isTransferable: false,
};

export default class PackageService {
  private readonly exampleUrl: string | undefined;
  private readonly examples: TypedPackageStub[];
  private readonly calculateCidFn: (files: File[]) => Promise<string>;
  private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly fileReaderFactory: () => FileReader;

  constructor(
    private idb: IDBService,
    private relay: RelayService,
    private localStorage: LocalStorageService,
    options: {
      exampleUrl?: string;
      examples?: TypedPackageStub[];
      calculateCidFn?: (files: File[]) => Promise<string>;
      fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
      fileReaderFactory?: () => FileReader;
    } = {}
  ) {
    this.exampleUrl = options.exampleUrl;
    this.examples = options.examples ?? [];
    this.calculateCidFn = options.calculateCidFn ?? calculateCid;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.fileReaderFactory = options.fileReaderFactory ?? (() => new FileReader());
  }

  list(): Array<TypedPackage | TypedPackageStub> {
    const local = (this.localStorage.get("packages") || []) as TypedPackage[];
    for (const pkg of local) {
      pkg.versions = pkg.versions.map(({ date, cid }: { date: Date | string; cid: string }) => ({
        date: new Date(date),
        cid,
      }));
    }

    const set = new Map(
      [...this.examples, ...local].map((pkg) => [pkg.name, pkg])
    ).values();

    return Array.from(set).sort((a, b) => (a.title >= b.title ? 1 : -1));
  }

  info(nameOrCid: string, uniqueMessageHash?: string): TypedPackage {
    const packages = (this.localStorage.get("packages") ||
      []) as TypedPackage[];

    const found = packages.find(
      (pkg) =>
        (pkg.name === nameOrCid ||
          pkg.versions.some((v: { cid: string }) => v.cid === nameOrCid)) &&
        (!uniqueMessageHash ||
          pkg.versions.some((v: { uniqueMessageHash?: string }) => v.uniqueMessageHash === uniqueMessageHash))
    );

    if (!found) throw new Error(`Package not found: ${nameOrCid}`);
    return found;
  }

  private storePackageInfo(
    title: string,
    name: string,
    description: string | undefined,
    cid: string,
    keywords: string[],
    capabilities: TypedPackageCapabilities,
    isNotLocal?: boolean,
    uniqueMessageHash?: string
  ): TypedPackage {
    const packages = (this.localStorage.get("packages") ||
      []) as TypedPackage[];

    // Locate the package with matching cid and uniqueMessageHash
    let pkg = packages.find(
      (pkg) =>
        pkg.name === name &&
        pkg.cid === cid &&
        pkg.uniqueMessageHash === uniqueMessageHash
    );

    if (!pkg) {
      const version = uniqueMessageHash
        ? { date: new Date(), cid, uniqueMessageHash }
        : { date: new Date(), cid };
      // Create new package entry if not found
      const createdPkg: TypedPackage = {
        title,
        name,
        cid,
        keywords,
        ...capabilities,
        ...(description ? { description } : {}),
        ...(isNotLocal ? { isNotLocal } : {}),
        ...(uniqueMessageHash ? { uniqueMessageHash } : {}),
        versions: [version],
      };
      pkg = createdPkg;
      packages.push(createdPkg);
    } else {
      // Update package and add new version info if it's an update
      Object.assign(pkg, {
        keywords,
        ...(description ? { description } : {}),
        ...(uniqueMessageHash ? { uniqueMessageHash } : {}),
        ...capabilities,
      });
      const version = uniqueMessageHash
        ? { date: new Date(), cid, uniqueMessageHash }
        : { date: new Date(), cid };
      pkg.versions.push(version);
    }

    // Save all packages back to LocalStorage under the single "packages" key
    this.localStorage.set("packages", packages);

    if (!pkg) throw new Error("Failed to create package entry");
    return pkg;
  }

  async extractAssets(zipFile: File, chain?: boolean): Promise<File[]> {
    const zip = await JSZip.loadAsync(zipFile);

    if (chain) {
      return await Promise.all(
        Array.from(Object.entries(zip.files))
          .filter(([filename]) => !filename.startsWith("."))
          .map(async ([filename, file]) => {
            const blob = await file.async("blob");
            const type = getMimeType(filename) || "application/octet-stream";
            return new File([blob], filename, { type });
          })
      );
    }

    return await Promise.all(
      Array.from(Object.entries(zip.files))
        .filter(
          ([filename]) => !filename.startsWith(".") && filename !== "chain.json"
        )
        .map(async ([filename, file]) => {
          const blob = await file.async("blob");
          const type = getMimeType(filename) || "application/octet-stream";
          return new File([blob], filename, { type });
        })
    );
  }

  private async storeAssets(cid: string, files: File[]): Promise<void> {
    const storeName = `package:${cid}`;
    
    try {
      if (!(await this.idb.hasStore(storeName))) {
        await this.idb.createStore(storeName);
      }

      await this.idb.setAll(
        storeName,
        Object.fromEntries(files.map((file) => [file.name, file]))
      );

      // Verify store exists and has data
      await this.verifyStoreExists(storeName, files.length);
    } catch (error) {
      // Check for quota errors
      if (error instanceof Error) {
        if (error.name === 'QuotaExceededError' || 
            error.message?.includes('quota') ||
            error.message?.includes('QuotaExceeded')) {
          throw new Error(
            `Device storage quota exceeded. Please free up space on your device and try again.`
          );
        }
      }
      throw error;
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
        throw new Error(
          `Device storage quota exceeded. Please free up space and try again.`
        );
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
        console.warn(`Store verification attempt ${attempt}/${maxRetries} failed:`, error);
        
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
    return Buffer.from(base64, "base64");
  }

  bufferToString(buffer: Buffer): string {
    return buffer.toString("utf8");
  }

  async getChainJson(filename: string, files: any): Promise<any> {
    const extractedFile = await this.extractAssets(files, true);
    const file = extractedFile.find((file: any) => file.name === filename);
    if (!file) throw new Error(`Invalid package: missing ${filename}`);

    const fileContent = await file.text();
    const json = JSON.parse(fileContent);

    json.events = json.events.map((event: MessageExt) => {
      if (event.data.startsWith("base64:")) {
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

  private async getCapabilities(
    files: File[]
  ): Promise<TypedPackageCapabilities> {
    if (files.findIndex((file) => file.name === "package.json") < 0)
      throw new Error("Invalid package: missing package.json");

    if (files.findIndex((file) => file.name === "ownable_bg.wasm") < 0)
      return capabilitiesStaticOwnable;

    const query: TypedCosmWasmMsg = await this.getPackageJson(
      "query_msg.json",
      files
    );
    const execute: TypedCosmWasmMsg = await this.getPackageJson(
      "execute_msg.json",
      files
    );

    const hasMethod = (schema: TypedCosmWasmMsg, find: string) =>
      schema.oneOf.findIndex((method: { required: string[] }) => method.required.includes(find)) >= 0;

    if (!hasMethod(query, "get_info"))
      throw new Error("Invalid package: missing `get_info` query method");

    return {
      isDynamic: true,
      hasMetadata: hasMethod(query, "get_metadata"),
      hasWidgetState: hasMethod(query, "get_widget_state"),
      isConsumable: hasMethod(execute, "consume"),
      isConsumer: hasMethod(query, "is_consumer_of"),
      isTransferable: hasMethod(execute, "transfer"),
    };
  }

  async processPackage(
    message: any,
    uniqueMessageHash?: string,
    isNotLocal = false
  ) {
    let chainJson: any;
    let files: File[];
    let packageJson: TypedDict;

    //Extract files
    if (isNotLocal) {
      files = await this.extractAssets(message.data.buffer, false);
      packageJson = await this.getPackageJson("package.json", files);
      chainJson = await this.getChainJson("chain.json", message.data.buffer);
    } else {
      files = message; // Local files
      packageJson = await this.getPackageJson("package.json", files);
    }

    //Check for required JSON files
    if (!packageJson) {
      throw new Error("Missing package.json in extracted assets");
    }
    if (isNotLocal && !chainJson) {
      throw new Error("Missing chain.json for relay package");
    }

    //Calculate CID
    const cid = await this.calculateCidFn(files);

    //Check for duplicates
    if (await this.idb.hasStore(`package:${cid}`)) {
      if (isNotLocal && chainJson && !(await this.isCurrentEvent(chainJson))) {
        console.warn(`Package with CID ${cid} is already current or newer.`);
        return null;
      }
    }

    //Prepare metadata
    const name = packageJson.name || "Unnamed Package";
    const title = name
      .replace(/^ownable-|-ownable$/, "")
      .replace(/[-_]+/, " ")
      .replace(/\b\w/, (c: string) => c.toUpperCase());
    const description = packageJson.description;
    const keywords: string[] = packageJson.keywords || [];
    const capabilities = await this.getCapabilities(files);

    //Store assets
    await this.storeAssets(cid, files);

    //Store package info
    const pkg = this.storePackageInfo(
      title,
      name,
      description,
      cid,
      keywords,
      capabilities,
      isNotLocal,
      uniqueMessageHash
    );

    //Attach chain if needed
    if (isNotLocal && chainJson) {
      pkg.chain = EventChain.from(chainJson);
    }

    if (uniqueMessageHash) {
      pkg.uniqueMessageHash = uniqueMessageHash;
    }

    return pkg;
  }

  async import(zipFile: File): Promise<TypedPackage> {
    const files = await this.extractAssets(zipFile);
    const pkg = await this.processPackage(files);

    if (!pkg) {
      throw new Error(
        "Failed to process package: duplicate or invalid package."
      );
    }

    // Verify store exists after import
    const storeName = `package:${pkg.cid}`;
    const hasStore = await this.idb.hasStore(storeName);
    
    if (!hasStore) {
      // Retry verification in background (non-blocking)
      this.retryStoreVerification(storeName, files.length, 3, 1000)
        .catch((error) => {
          console.error(`Background store verification failed after retries:`, error);
          // Optionally notify user or log to error tracking service
        });
      
      // Still return the package even if verification is pending
      // The background retry will handle it
    } else {
      // Store exists, verify data integrity
      try {
        await this.verifyStoreExists(storeName, files.length);
      } catch (error) {
        // If verification fails, start background retry
        console.warn(`Initial store verification failed, retrying in background:`, error);
        this.retryStoreVerification(storeName, files.length, 3, 1000)
          .catch((retryError) => {
            console.error(`Background store verification failed after retries:`, retryError);
          });
      }
    }

    return pkg;
  }

  async importFromRelay() {
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
          recipient: data.message.recipient || "",
          sender: data.message.sender || {},
          size: data.message.data?.length || 0,
          timestamp: new Date(data.message.timestamp || Date.now()),
          type: data.message.meta?.type || "basic",
          data: data.message.data,
          signature: data.message.signature,
          _hash: data.message.hash,
          parsedData: data.message.parsedData || "",
          messageHash: data.hash,
          message: data.message,
        }));

      if (validMessages.length === 0) {
        return null;
      }

      const filteredMessages = await this.relay.checkDuplicateMessage(
        validMessages
      );

      let triggerRefresh = false;

      const results = await Promise.all(
        filteredMessages.map(async (data: any) => {
          try {
            const { message, messageHash } = data;
            const files = await this.extractAssets(message.data.buffer);

            if (files.length === 0) return null;

            // Pass the hash to the processing function
            const pkg = await this.processPackage(files, messageHash, true);

            if (!pkg) return;

            if (await this.idb.hasStore(`package:${pkg.cid}`)) {
              triggerRefresh = true;
            }

            return pkg;
          } catch (err) {
            console.error("Error processing data:", err);
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
      console.error("Error:", error);
      return null;
    }
  }

  async isCurrentEvent(chainJson: EventChain) {
    let existingChain;
    if (await this.idb.hasStore(`ownable:${chainJson.id}`)) {
      existingChain = await this.idb.get(`ownable:${chainJson.id}`, "chain");
    }

    if (existingChain === undefined || existingChain.events === undefined) {
      return true;
    }
    if (existingChain.events?.length) {
      if (chainJson.events.length > existingChain.events.length) {
        return true;
      }
    } else {
      return false;
    }
  }

  async downloadExample(key: string): Promise<TypedPackage> {
    if (!this.exampleUrl)
      throw new Error("Unable to download example ownable: URL not configured");

    const filename = key.replace(/^ownable-/, "") + ".zip";

    const response = await this.fetchFn(`${this.exampleUrl}/${filename}`);
    if (!response.ok)
      throw new Error(
        `Failed to download example ownable: ${response.statusText}`
      );

    const contentType = response.headers.get("Content-Type")?.trim();
    if (
      contentType !== "application/zip" &&
      contentType !== "application/x-zip-compressed"
    )
      throw new Error(
        "Failed to download example ownable: invalid content type"
      );

    const zipFile = new File([await response.blob()], `${key}.zip`, {
      type: "application/zip",
    });

    return this.import(zipFile);
  }

  async getAsset(
    cid: string,
    name: string,
    read: (fr: FileReader, contents: Blob | File) => void
  ): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fileReader = this.fileReaderFactory();
      this.idb.get(`package:${cid}`, name).then(
        (mediaFile: File) => {
          if (!mediaFile) {
            reject(`Asset "${name}" is not in package ${cid}`);
          }

          fileReader.onload = (event) => {
            const result = event.target?.result;
            if (result === null || result === undefined) {
              reject(new Error(`Failed to read asset "${name}" from package ${cid}`));
              return;
            }
            resolve(result);
          };

          read(fileReader, mediaFile);
        },
        (error) => reject(error)
      );
    });
  }

  getAssetAsText(cid: string, name: string): Promise<string> {
    const read = (fr: FileReader, mediaFile: Blob | File) =>
      fr.readAsText(mediaFile);
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  getAssetAsDataUri(cid: string, name: string): Promise<string> {
    const read = (fr: FileReader, mediaFile: Blob | File) =>
      fr.readAsDataURL(mediaFile);
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  async zip(cid: string): Promise<JSZip> {
    const zip = new JSZip();
    const files = await this.idb.getAll(`package:${cid}`);

    for (const file of files) {
      zip.file(file.name, file);
    }
    return zip;
  }
}
