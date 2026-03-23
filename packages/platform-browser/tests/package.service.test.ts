import { describe, expect, it, vi } from 'vitest';

import PackageService from '../src/services/Package.service';

describe('PackageService', () => {
  const capabilities = {
    isDynamic: false,
    hasMetadata: false,
    hasWidgetState: false,
    isConsumable: false,
    isConsumer: false,
    isTransferable: false,
  };

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

  it('uses injected fetch when downloading examples', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      statusText: 'OK',
      headers: { get: () => 'application/zip' },
      blob: async () => new Blob(['zip-bytes'], { type: 'application/zip' }),
    }));
    const expected = { cid: 'cid-123' } as any;

    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any, {
      exampleUrl: 'https://examples.test',
      fetchFn: fetchFn as any,
    });
    vi.spyOn(service, 'import').mockResolvedValue(expected);

    const result = await service.downloadExample('ownable-robot');

    expect(fetchFn).toHaveBeenCalledWith('https://examples.test/robot.zip');
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

  it('throws from info when package is missing', () => {
    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
    expect(() => service.info('missing')).toThrow('Package not found');
  });

  it('getAsset rejects when idb returns no media file', async () => {
    const fileReaderFactory = vi.fn(() => ({ readAsText: vi.fn() }));
    const service = new PackageService(
      { get: vi.fn(async () => undefined) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { fileReaderFactory: fileReaderFactory as any }
    );

    await expect(service.getAssetAsText('cid-1', 'missing.txt')).rejects.toContain('Asset \"missing.txt\" is not in package cid-1');
  });

  it('processes local package and stores metadata', async () => {
    const local: any[] = [];
    const localStorage = {
      get: vi.fn((key: string) => (key === 'packages' ? local : [])),
      set: vi.fn((_key: string, value: any[]) => {
        local.splice(0, local.length, ...value);
      }),
    };
    const idb = {
      hasStore: vi.fn().mockResolvedValue(false),
      createStore: vi.fn(),
      setAll: vi.fn(),
      keys: vi.fn().mockResolvedValue(['package.json']),
    };
    const service = new PackageService(idb as any, {} as any, localStorage as any, {
      calculateCidFn: vi.fn().mockResolvedValue('cid-1'),
    });
    vi.spyOn(service as any, 'getPackageJson').mockResolvedValue({
      name: 'ownable-test',
      description: 'test desc',
      keywords: ['k1'],
    });
    vi.spyOn(service as any, 'getCapabilities').mockResolvedValue(capabilities);
    vi.spyOn(service as any, 'storeAssets').mockResolvedValue(undefined);

    const pkg = await service.processPackage([{ name: 'package.json' }] as any);
    expect(pkg?.cid).toBe('cid-1');
    expect(localStorage.set).toHaveBeenCalled();
  });

  it('throws from import when processPackage returns null', async () => {
    const service = new PackageService(
      { hasStore: vi.fn().mockResolvedValue(false) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service, 'extractAssets').mockResolvedValue([{ name: 'package.json' }] as any);
    vi.spyOn(service, 'processPackage').mockResolvedValue(null as any);

    await expect(service.import(new File([new Blob(['x'])], 'x.zip'))).rejects.toThrow(
      'Failed to process package'
    );
  });

  it('returns null for duplicate relay package when chain is not current', async () => {
    const service = new PackageService(
      {
        hasStore: vi.fn().mockResolvedValue(true),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { calculateCidFn: vi.fn().mockResolvedValue('cid-1') }
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([{ name: 'package.json' }]);
    vi.spyOn(service as any, 'getPackageJson').mockResolvedValue({ name: 'pkg' });
    vi.spyOn(service as any, 'getChainJson').mockResolvedValue({ events: [] });
    vi.spyOn(service as any, 'isCurrentEvent').mockResolvedValue(false);

    const result = await service.processPackage({ data: { buffer: new Uint8Array([1]) } }, 'm1', true);
    expect(result).toBeNull();
  });

  it('imports from relay and filters invalid messages', async () => {
    const relay = {
      readAll: vi.fn().mockResolvedValue([
        { hash: 'h1', message: { data: { buffer: new Uint8Array([1]) }, timestamp: Date.now(), meta: {} } },
      ]),
      checkDuplicateMessage: vi.fn().mockImplementation(async (items) => items),
    };
    const service = new PackageService(
      { hasStore: vi.fn().mockResolvedValue(false) } as any,
      relay as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([{ name: 'package.json' }]);
    vi.spyOn(service, 'processPackage').mockResolvedValue({ cid: 'cid-1', name: 'pkg' } as any);

    const result = await service.importFromRelay();
    expect(result?.[0]).toHaveLength(1);
    expect(relay.checkDuplicateMessage).toHaveBeenCalled();
  });

  it('returns null when importFromRelay has no messages or errors', async () => {
    const serviceEmpty = new PackageService(
      {} as any,
      { readAll: vi.fn().mockResolvedValue([]) } as any,
      { get: () => [], set: () => undefined } as any
    );
    await expect(serviceEmpty.importFromRelay()).resolves.toBeNull();

    const serviceErr = new PackageService(
      {} as any,
      { readAll: vi.fn().mockRejectedValue(new Error('relay error')) } as any,
      { get: () => [], set: () => undefined } as any
    );
    await expect(serviceErr.importFromRelay()).resolves.toBeNull();
  });

  it('validates download content type', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        headers: { get: () => 'text/plain' },
        blob: async () => new Blob(['x']),
      })
      .mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        headers: { get: () => 'application/zip' },
        blob: async () => new Blob(['x']),
      });
    const service = new PackageService(
      {} as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { exampleUrl: 'https://examples.test', fetchFn: fetchFn as any }
    );

    await expect(service.downloadExample('ownable-x')).rejects.toThrow('invalid content type');
    await expect(service.downloadExample('ownable-x')).rejects.toThrow('Failed to download example ownable');
  });

  it('parses chain json and decodes base64 event payloads', async () => {
    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
    const chainJson = {
      events: [
        {
          data: `base64:${Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64')}`,
        },
      ],
    };
    vi.spyOn(service, 'extractAssets').mockResolvedValue([
      new File([JSON.stringify(chainJson)], 'chain.json', { type: 'application/json' }),
    ] as any);

    const parsed = await service.getChainJson('chain.json', new File([new Blob(['zip'])], 'x.zip'));
    expect(parsed.events[0].parsedData).toEqual({ hello: 'world' });
  });

  it('evaluates current event length logic', async () => {
    const idb = {
      hasStore: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue({ events: [1, 2] }),
    };
    const service = new PackageService(idb as any, {} as any, { get: () => [], set: () => undefined } as any);

    await expect(service.isCurrentEvent({ id: 'chain-1', events: [1, 2, 3] } as any)).resolves.toBe(true);
    await expect(service.isCurrentEvent({ id: 'chain-1', events: [1] } as any)).resolves.toBeUndefined();
  });

  it('computes capabilities for static and dynamic packages', async () => {
    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
    const staticCaps = await (service as any).getCapabilities([
      new File(['{}'], 'package.json', { type: 'application/json' }),
    ]);
    expect(staticCaps.isDynamic).toBe(false);

    vi.spyOn(service as any, 'getPackageJson')
      .mockResolvedValueOnce({ oneOf: [{ required: ['get_info', 'get_metadata', 'is_consumer_of', 'get_widget_state'] }] })
      .mockResolvedValueOnce({ oneOf: [{ required: ['consume', 'transfer'] }] });
    const dynamicCaps = await (service as any).getCapabilities([
      new File(['{}'], 'package.json'),
      new File(['wasm'], 'ownable_bg.wasm'),
      new File(['{}'], 'query_msg.json'),
      new File(['{}'], 'execute_msg.json'),
    ]);
    expect(dynamicCaps).toEqual({
      isDynamic: true,
      hasMetadata: true,
      hasWidgetState: true,
      isConsumable: true,
      isConsumer: true,
      isTransferable: true,
    });
  });

  it('throws when package.json is missing or query schema lacks get_info', async () => {
    const service = new PackageService({} as any, {} as any, { get: () => [], set: () => undefined } as any);

    await expect((service as any).getCapabilities([new File(['x'], 'foo.txt')])).rejects.toThrow(
      'missing package.json'
    );

    vi.spyOn(service as any, 'getPackageJson')
      .mockResolvedValueOnce({ oneOf: [{ required: ['get_metadata'] }] })
      .mockResolvedValueOnce({ oneOf: [{ required: [] }] });
    await expect(
      (service as any).getCapabilities([
        new File(['{}'], 'package.json'),
        new File(['wasm'], 'ownable_bg.wasm'),
        new File(['{}'], 'query_msg.json'),
        new File(['{}'], 'execute_msg.json'),
      ])
    ).rejects.toThrow('missing `get_info` query method');
  });

  it('reads assets as data URI and propagates read errors', async () => {
    const okFactory = vi.fn(() => {
      const reader: any = {
        onload: null,
        readAsDataURL: () => reader.onload?.({ target: { result: 'data:text/plain;base64,QQ==' } }),
      };
      return reader;
    });
    const service = new PackageService(
      { get: vi.fn().mockResolvedValue(new File(['A'], 'a.txt')) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { fileReaderFactory: okFactory as any }
    );
    await expect(service.getAssetAsDataUri('cid-1', 'a.txt')).resolves.toBe('data:text/plain;base64,QQ==');

    const badFactory = vi.fn(() => {
      const reader: any = {
        onload: null,
        readAsText: () => reader.onload?.({ target: { result: null } }),
      };
      return reader;
    });
    const badService = new PackageService(
      { get: vi.fn().mockResolvedValue(new File(['A'], 'a.txt')) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { fileReaderFactory: badFactory as any }
    );
    await expect(badService.getAssetAsText('cid-1', 'a.txt')).rejects.toThrow('Failed to read asset');
  });

});
