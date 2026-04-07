import JSZip from 'jszip';
import type { PackageAssetIO, TypedPackage } from '@ownables/core';
import type { RNPackageAssetIOOptions } from '../types/PlatformReactNative';

class RNFileReaderLike {
  public result: string | ArrayBuffer | null = null;
  public onload: ((event: { target: { result: string | ArrayBuffer | null } }) => void) | null = null;

  private emitLoad(): void {
    this.onload?.({ target: { result: this.result } });
  }

  readAsArrayBuffer(contents: Uint8Array | ArrayBuffer | string): void {
    const bytes = toUint8Array(contents);
    this.result = Uint8Array.from(bytes).buffer;
    this.emitLoad();
  }

  readAsText(contents: Uint8Array | ArrayBuffer | string): void {
    this.result = new TextDecoder().decode(toUint8Array(contents));
    this.emitLoad();
  }

  readAsDataURL(contents: Uint8Array | ArrayBuffer | string): void {
    const base64 = toBase64(toUint8Array(contents));
    this.result = `data:application/octet-stream;base64,${base64}`;
    this.emitLoad();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

function toUint8Array(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

export default class RNPackageAssetIO implements PackageAssetIO {
  private readonly packageRoot: string;

  constructor(private readonly options: RNPackageAssetIOOptions) {
    this.packageRoot = options.packageRoot ?? 'package';
  }

  info(nameOrCid: string, uniqueMessageHash?: string): TypedPackage {
    return this.options.infoResolver(nameOrCid, uniqueMessageHash);
  }

  private assetPath(cid: string, name: string): string {
    return `${this.packageRoot}/${cid}/${name}`;
  }

  async getAsset(
    cid: string,
    name: string,
    read: (reader: unknown, contents: unknown) => void
  ): Promise<string | ArrayBuffer> {
    const content = await this.options.fileSystem.readFile(this.assetPath(cid, name));
    if (content === undefined || content === null) {
      throw new Error(`Asset "${name}" is not in package ${cid}`);
    }

    const reader = new RNFileReaderLike();

    return await new Promise((resolve, reject) => {
      reader.onload = (event) => {
        const result = event.target.result;
        if (result === null || result === undefined) {
          reject(new Error(`Failed to read asset "${name}" from package ${cid}`));
          return;
        }
        resolve(result);
      };

      try {
        read(reader, content);

        if (reader.result === null) {
          reader.readAsArrayBuffer(content as Uint8Array | ArrayBuffer | string);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  getAssetAsText(cid: string, name: string): Promise<string> {
    const read = (reader: unknown, mediaFile: unknown) =>
      (reader as RNFileReaderLike).readAsText(mediaFile as Uint8Array | ArrayBuffer | string);

    return this.getAsset(cid, name, read) as Promise<string>;
  }

  async zip(cid: string): Promise<unknown> {
    if (this.options.zipLoader) {
      return this.options.zipLoader(cid);
    }

    const prefix = `${this.packageRoot}/${cid}/`;
    const files = await this.options.fileSystem.listFiles(prefix);

    if (files.length === 0) {
      throw new Error(`No package assets found for ${cid}`);
    }

    const zip = new JSZip();

    for (const absolutePath of files) {
      if (!absolutePath.startsWith(prefix)) continue;

      const name = absolutePath.slice(prefix.length);
      if (!name) continue;

      const contents = await this.options.fileSystem.readFile(absolutePath);
      if (contents === undefined || contents === null) {
        throw new Error(`Asset "${name}" is not in package ${cid}`);
      }

      zip.file(name, toUint8Array(contents as Uint8Array | ArrayBuffer | string));
    }

    return zip;
  }
}
