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
});
