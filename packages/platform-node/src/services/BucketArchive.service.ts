import JSZip from 'jszip';
import type { ArchiveService, ImportedArchive } from '@ownables/core';
import type { BucketArchiveServiceOptions } from '../types/PlatformNode';

const DEFAULT_ROOT = 'archives';

function normalizeName(name: string): string {
  return name.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
}

function toBytes(value: string | Uint8Array | Buffer): Uint8Array {
  if (typeof value === 'string') return Uint8Array.from(Buffer.from(value, 'utf8'));
  return Uint8Array.from(value);
}

function chainCandidateNames(files: string[]): string[] {
  return files.filter((name) => name === 'eventChain.json' || name === 'chain.json');
}

export default class BucketArchiveService implements ArchiveService {
  private readonly bucket;
  private readonly cidCalculator;
  private readonly rootPrefix;

  constructor(options: BucketArchiveServiceOptions) {
    this.bucket = options.bucket;
    this.cidCalculator = options.cidCalculator;
    this.rootPrefix = options.rootPrefix ?? DEFAULT_ROOT;
  }

  private packagePrefix(cid: string): string {
    return `${this.rootPrefix}/packages/${cid}`;
  }

  private packageZipPath(cid: string): string {
    return `${this.packagePrefix(cid)}/${cid}.zip`;
  }

  private chainPath(cid: string): string {
    return `${this.rootPrefix}/chains/${cid}/eventChain.json`;
  }

  async importArchive(data: Uint8Array): Promise<ImportedArchive> {
    const loaded = await new JSZip().loadAsync(data, { createFolders: true });
    const fileEntries = Object.entries(loaded.files)
      .filter(([, file]) => !file.dir)
      .map(([name, file]) => [normalizeName(name), file] as const);

    const files = new Map<string, Uint8Array>();
    for (const [name, file] of fileEntries) {
      files.set(name, await file.async('uint8array'));
    }

    const candidates = chainCandidateNames(Array.from(files.keys()));
    if (candidates.length === 0) {
      throw new Error("Invalid package: 'eventChain.json' or 'chain.json' is required");
    }

    const chainFileName = candidates.includes('eventChain.json')
      ? 'eventChain.json'
      : 'chain.json';

    const chainBytes = files.get(chainFileName);
    if (!chainBytes) {
      throw new Error(`Missing chain payload at ${chainFileName}`);
    }

    const chainJson = JSON.parse(Buffer.from(chainBytes).toString('utf8')) as Record<string, unknown>;

    files.delete('eventChain.json');
    files.delete('chain.json');

    const sorted = new Map(
      Array.from(files.entries()).sort(([a], [b]) => a.localeCompare(b))
    );

    const cid = await this.cidCalculator.calculate(sorted);

    for (const [name, contents] of sorted.entries()) {
      await this.bucket.put(`${this.packagePrefix(cid)}/${name}`, contents);
    }

    const zip = new JSZip();
    for (const [name, contents] of sorted.entries()) {
      zip.file(name, Buffer.from(contents));
    }

    const zipped = await zip.generateAsync({ type: 'uint8array' });
    await this.bucket.put(this.packageZipPath(cid), zipped);
    await this.bucket.put(this.chainPath(cid), chainBytes);

    return {
      cid,
      chainJson,
      chainFileName,
      packageFiles: Array.from(sorted.keys()),
    };
  }

  async hasPackage(cid: string): Promise<boolean> {
    const zip = await this.bucket.get(this.packageZipPath(cid));
    if (zip !== undefined) return true;

    const keys = await this.bucket.list();
    const prefix = `${this.packagePrefix(cid)}/`;
    return keys.some((key) => key.startsWith(prefix));
  }

  async hasChain(cid: string): Promise<boolean> {
    return (await this.bucket.get(this.chainPath(cid))) !== undefined;
  }

  async readChain(cid: string): Promise<Record<string, unknown>> {
    const chain = await this.bucket.get(this.chainPath(cid));
    if (chain === undefined) {
      throw new Error(`Unknown chain for cid ${cid}`);
    }

    return JSON.parse(Buffer.from(toBytes(chain)).toString('utf8')) as Record<string, unknown>;
  }

  async readPackageZip(cid: string): Promise<Uint8Array> {
    const zip = await this.bucket.get(this.packageZipPath(cid));
    if (zip === undefined) {
      throw new Error(`Unknown package archive for cid ${cid}`);
    }

    return toBytes(zip);
  }
}
