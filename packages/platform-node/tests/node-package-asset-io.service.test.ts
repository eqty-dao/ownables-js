import { describe, expect, it } from 'vitest';

import NodePackageAssetIO from '../src/services/NodePackageAssetIO.service';

const basePkg = {
  title: 'Pkg',
  name: 'pkg',
  cid: 'cid-1',
  versions: [{ date: new Date(), cid: 'cid-1' }],
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  isConsumable: false,
  isConsumer: false,
  isTransferable: false,
};

describe('NodePackageAssetIO', () => {
  it('delegates info and reads text assets', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async (_cid, name) => (name === 'ownable.js' ? 'console.log("ok")' : ''),
    });

    expect(io.info('cid-1')).toEqual(basePkg);
    await expect(io.getAssetAsText('cid-1', 'ownable.js')).resolves.toContain('ok');
  });

  it('supports getAsset with read callback and arraybuffer output', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => Uint8Array.from([1, 2, 3]),
    });

    const result = await io.getAsset('cid-1', 'ownable_bg.wasm', (reader: any, file: any) => {
      reader.readAsArrayBuffer(file);
    });

    expect(result instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it('falls back to arraybuffer read when callback does not read', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => Buffer.from([9, 8, 7]),
    });

    const result = await io.getAsset('cid-1', 'ownable_bg.wasm', () => {
      // Intentionally no-op: service must fallback to readAsArrayBuffer.
    });

    expect(result instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual([9, 8, 7]);
  });

  it('supports data-url reads', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const result = await io.getAsset('cid-1', 'blob.bin', (reader: any, file: any) => {
      reader.readAsDataURL(file);
    });

    expect(typeof result).toBe('string');
    expect(result).toContain('data:application/octet-stream;base64,');
  });

  it('builds zip with assetList and returns zipLoader result when configured', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async (_cid, name) => (name === 'a.txt' ? 'A' : 'B'),
      assetList: async () => ['a.txt', 'b.txt'],
    });

    const zip = await io.zip('cid-1');
    const files = Object.keys(zip.files).sort();
    expect(files).toEqual(['a.txt', 'b.txt']);

    const withZipLoader = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => 'x',
      zipLoader: async () => ({ custom: true }),
    });

    await expect(withZipLoader.zip('cid-1')).resolves.toEqual({ custom: true });
  });

  it('throws when requested asset is missing', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => undefined as any,
    });

    await expect(
      io.getAsset('cid-1', 'missing.txt', (reader: any, file: any) => reader.readAsText(file))
    ).rejects.toThrow('is not in package');
  });

  it('throws when zip cannot be produced from options', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => 'x',
    });

    await expect(io.zip('cid-1')).rejects.toThrow('zipLoader or assetList must be provided');
  });

  it('rejects when reader produces null result', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => 'abc',
    });

    await expect(
      io.getAsset('cid-1', 'bad.txt', (reader: any) => {
        reader.onload?.({ target: { result: null } });
      })
    ).rejects.toThrow('Failed to read asset');
  });

  it('rejects when read callback throws', async () => {
    const io = new NodePackageAssetIO({
      infoResolver: () => basePkg as any,
      assetLoader: async () => 'abc',
    });

    await expect(
      io.getAsset('cid-1', 'bad.txt', () => {
        throw new Error('read failed');
      })
    ).rejects.toThrow('read failed');
  });
});
