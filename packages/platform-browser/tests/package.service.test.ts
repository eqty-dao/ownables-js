import { describe, expect, it, vi } from 'vitest';

import PackageService from '../src/services/Package.service';

describe('PackageService', () => {
  it('merges injected examples with stored packages', () => {
    const localStorage = {
      get: (key: string) =>
        key === 'packages'
          ? [
              {
                title: 'Stored',
                name: 'stored',
                cid: 'cid-1',
                versions: [{ date: new Date(), cid: 'cid-1' }],
                isDynamic: false,
                hasMetadata: false,
                hasWidgetState: false,
                isConsumable: false,
                isConsumer: false,
                isTransferable: false,
              },
            ]
          : undefined,
      set: () => undefined,
    };

    const service = new PackageService({} as any, {} as any, localStorage as any, {
      examples: [{ title: 'Example', name: 'example', stub: true }],
    });

    const list = service.list();
    expect(list.map((pkg) => pkg.name)).toEqual(['example', 'stored']);
  });

  it('throws when downloading example without URL', async () => {
    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any, {
      exampleUrl: '',
    });

    await expect(service.downloadExample('ownable-robot')).rejects.toThrow('URL not configured');
  });

  it('uses injected fetch and file factory when downloading examples', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      statusText: 'OK',
      headers: { get: () => 'application/zip' },
      blob: async () => new Blob(['zip-bytes'], { type: 'application/zip' }),
    }));
    const fileFactory = vi.fn(() => ({ fakeFile: true } as any));
    const expected = { cid: 'cid-123' } as any;

    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any, {
      exampleUrl: 'https://examples.test',
      fetchFn: fetchFn as any,
      fileFactory: fileFactory as any,
    });
    vi.spyOn(service, 'import').mockResolvedValue(expected);

    const result = await service.downloadExample('ownable-robot');

    expect(fetchFn).toHaveBeenCalledWith('https://examples.test/robot.zip');
    expect(fileFactory).toHaveBeenCalledTimes(1);
    expect(fileFactory).toHaveBeenCalledWith(expect.any(Array), 'ownable-robot.zip', {
      type: 'application/zip',
    });
    expect(result).toBe(expected);
  });

  it('uses injected fileReader factory for getAssetAsText', async () => {
    const fileReaderFactory = vi.fn(() => {
      const reader: any = {
        onload: null,
        readAsText: () => {
          reader.onload?.({ target: { result: 'asset-text' } });
        },
      };
      return reader;
    });
    const idb = {
      get: vi.fn(async () => ({ fakeBlob: true })),
    };

    const service = new PackageService(idb as any, {} as any, { get: () => [], set: () => undefined } as any, {
      fileReaderFactory: fileReaderFactory as any,
    });

    await expect(service.getAssetAsText('cid-1', 'asset.txt')).resolves.toBe('asset-text');
    expect(fileReaderFactory).toHaveBeenCalledTimes(1);
    expect(idb.get).toHaveBeenCalledWith('package:cid-1', 'asset.txt');
  });
});
