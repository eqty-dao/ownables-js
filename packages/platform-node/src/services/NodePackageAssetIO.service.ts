import JSZip from 'jszip';
import type { PackageAssetIO } from '@ownables/core';
import type { TypedPackage } from '@ownables/core';
import type { NodePackageAssetIOOptions } from '../types/PlatformNode';

class NodeFileReaderLike {
  public result: string | ArrayBuffer | null = null;
  public onload: ((event: { target: { result: string | ArrayBuffer | null } }) => void) | null = null;

  private emitLoad(): void {
    this.onload?.({ target: { result: this.result } });
  }

  readAsArrayBuffer(contents: Uint8Array | ArrayBuffer | Buffer | string): void {
    const bytes = toUint8Array(contents);
    this.result = Uint8Array.from(bytes).buffer;
    this.emitLoad();
  }

  readAsText(contents: Uint8Array | ArrayBuffer | Buffer | string): void {
    this.result = Buffer.from(toUint8Array(contents)).toString('utf8');
    this.emitLoad();
  }

  readAsDataURL(contents: Uint8Array | ArrayBuffer | Buffer | string): void {
    const base64 = Buffer.from(toUint8Array(contents)).toString('base64');
    this.result = `data:application/octet-stream;base64,${base64}`;
    this.emitLoad();
  }
}

function toUint8Array(value: Uint8Array | ArrayBuffer | Buffer | string): Uint8Array {
  if (typeof value === 'string') return Uint8Array.from(Buffer.from(value, 'utf8'));
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

export default class NodePackageAssetIO implements PackageAssetIO {
  constructor(private readonly options: NodePackageAssetIOOptions) {}

  info(nameOrCid: string, uniqueMessageHash?: string): TypedPackage {
    return this.options.infoResolver(nameOrCid, uniqueMessageHash);
  }

  async getAsset(
    cid: string,
    name: string,
    read: (reader: unknown, contents: unknown) => void
  ): Promise<string | ArrayBuffer> {
    const content = await this.options.assetLoader(cid, name);
    if (content === undefined || content === null) {
      throw new Error(`Asset "${name}" is not in package ${cid}`);
    }

    const reader = new NodeFileReaderLike();

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
          reader.readAsArrayBuffer(content);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  getAssetAsText(cid: string, name: string): Promise<string> {
    const read = (reader: unknown, mediaFile: unknown) =>
      (reader as NodeFileReaderLike).readAsText(
        mediaFile as Uint8Array | ArrayBuffer | Buffer | string
      );
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  async zip(cid: string): Promise<unknown> {
    if (this.options.zipLoader) {
      return this.options.zipLoader(cid);
    }

    if (!this.options.assetList) {
      throw new Error('zipLoader or assetList must be provided');
    }

    const zip = new JSZip();
    const assetNames = await this.options.assetList(cid);

    for (const name of assetNames) {
      const contents = await this.options.assetLoader(cid, name);
      zip.file(name, Buffer.from(toUint8Array(contents)));
    }

    return zip;
  }
}
