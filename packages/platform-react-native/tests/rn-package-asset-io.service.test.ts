import { describe, expect, it } from 'vitest';

import RNPackageAssetIO from '../src/services/RNPackageAssetIO.service';

const basePkg = {
  title: 'Pkg',
  name: 'pkg',
  cid: 'cid-1',
  versions: [{ date: new Date(), cid: 'cid-1' }],
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  hasAttachments: false,
  isClosable: false,
  isConsumable: false,
  isConsumer: false,
  isTransferable: false,
};

class InMemoryFileSystem {
  private readonly files = new Map<string, Uint8Array>();

  constructor(seed: Record<string, string | Uint8Array> = {}) {
    for (const [path, value] of Object.entries(seed)) {
      const bytes =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : value;
      this.files.set(path, Uint8Array.from(bytes));
    }
  }

  async readFile(path: string): Promise<Uint8Array | undefined> {
    return this.files.get(path);
  }

  async listFiles(prefix: string): Promise<string[]> {
    return Array.from(this.files.keys()).filter((path) => path.startsWith(prefix));
  }
}

describe('RNPackageAssetIO', () => {
  it('delegates info and reads text assets', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem({
        'package/cid-1/ownable.js': 'console.log("ok")',
      }),
    });

    expect(io.info('cid-1')).toEqual(basePkg);
    await expect(io.getAssetAsText('cid-1', 'ownable.js')).resolves.toContain('ok');
  });

  it('supports getAsset callback and arraybuffer fallback', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem({
        'package/cid-1/ownable_bg.wasm': Uint8Array.from([1, 2, 3]),
      }),
    });

    const result = await io.getAsset('cid-1', 'ownable_bg.wasm', (reader: any, file: any) => {
      reader.readAsArrayBuffer(file);
    });

    expect(result instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it('supports data-url reads', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem({
        'package/cid-1/blob.bin': Uint8Array.from([1, 2, 3]),
      }),
    });

    const result = await io.getAsset('cid-1', 'blob.bin', (reader: any, file: any) => {
      reader.readAsDataURL(file);
    });

    expect(typeof result).toBe('string');
    expect(result).toContain('data:application/octet-stream;base64,');
  });

  it('builds zip from file system and supports zipLoader override', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem({
        'package/cid-1/a.txt': 'A',
        'package/cid-1/b.txt': 'B',
      }),
    });

    const zip = await io.zip('cid-1');
    const files = Object.keys((zip as any).files).sort();
    expect(files).toEqual(['a.txt', 'b.txt']);

    const withZipLoader = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem(),
      zipLoader: async () => ({ custom: true }),
    });

    await expect(withZipLoader.zip('cid-1')).resolves.toEqual({ custom: true });
  });

  it('throws when asset is missing', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem(),
    });

    await expect(
      io.getAsset('cid-1', 'missing.txt', (reader: any, file: any) => reader.readAsText(file))
    ).rejects.toThrow('is not in package');
  });

  it('throws when zip has no indexed files', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem(),
    });

    await expect(io.zip('cid-1')).rejects.toThrow('No package assets found');
  });

  it('rejects when reader produces null result', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem({
        'package/cid-1/bad.txt': 'abc',
      }),
    });

    await expect(
      io.getAsset('cid-1', 'bad.txt', (reader: any) => {
        reader.onload?.({ target: { result: null } });
      })
    ).rejects.toThrow('Failed to read asset');
  });

  it('rejects when callback throws', async () => {
    const io = new RNPackageAssetIO({
      infoResolver: () => basePkg as any,
      fileSystem: new InMemoryFileSystem({
        'package/cid-1/bad.txt': 'abc',
      }),
    });

    await expect(
      io.getAsset('cid-1', 'bad.txt', () => {
        throw new Error('read failed');
      })
    ).rejects.toThrow('read failed');
  });
});
