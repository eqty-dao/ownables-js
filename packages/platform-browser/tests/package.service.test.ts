import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { EventChain } from 'eqty-core';

import PackageService from '../src/services/Package.service';

describe('PackageService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (idb: any, relay: any, localStorage: any, options: any = {}) =>
    new PackageService(idb, relay, localStorage, { ...options, logger: options.logger ?? logger });

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

    const service = createService({} as any, {} as any, localStorage as any, {
      examples: [{ title: 'Example', name: 'example', stub: true }],
    });

    const list = service.list();
    expect(list.map((pkg) => pkg.name)).toEqual(['example', 'stored']);
  });

  it('throws when downloading example without URL', async () => {
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any, {
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

    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any, {
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

    const service = createService(idb as any, {} as any, { get: () => [], set: () => undefined } as any, {
      fileReaderFactory: fileReaderFactory as any,
    });

    await expect(service.getAssetAsText('cid-1', 'asset.txt')).resolves.toBe('asset-text');
    expect(fileReaderFactory).toHaveBeenCalledTimes(1);
    expect(idb.get).toHaveBeenCalledWith('package:cid-1', 'asset.txt');
  });

  it('throws from info when package is missing', () => {
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
    expect(() => service.info('missing')).toThrow('Package not found');
  });

  it('getAsset rejects when idb returns no media file', async () => {
    const fileReaderFactory = vi.fn(() => ({ readAsText: vi.fn() }));
    const service = createService(
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
    const service = createService(idb as any, {} as any, localStorage as any, {
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
    const service = createService(
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
    const service = createService(
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
    const service = createService(
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
    const serviceEmpty = createService(
      {} as any,
      { readAll: vi.fn().mockResolvedValue([]) } as any,
      { get: () => [], set: () => undefined } as any
    );
    await expect(serviceEmpty.importFromRelay()).resolves.toBeNull();

    const serviceErr = createService(
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
    const service = createService(
      {} as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { exampleUrl: 'https://examples.test', fetchFn: fetchFn as any }
    );

    await expect(service.downloadExample('ownable-x')).rejects.toThrow('invalid content type');
    await expect(service.downloadExample('ownable-x')).rejects.toThrow('Failed to download example ownable');
  });

  it('parses chain json and decodes base64 event payloads', async () => {
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
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
    const service = createService(idb as any, {} as any, { get: () => [], set: () => undefined } as any);

    await expect(service.isCurrentEvent({ id: 'chain-1', events: [1, 2, 3] } as any)).resolves.toBe(true);
    await expect(service.isCurrentEvent({ id: 'chain-1', events: [1] } as any)).resolves.toBeUndefined();
  });

  it('computes capabilities for static and dynamic packages', async () => {
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
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
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any);

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
    const service = createService(
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
    const badService = createService(
      { get: vi.fn().mockResolvedValue(new File(['A'], 'a.txt')) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { fileReaderFactory: badFactory as any }
    );
    await expect(badService.getAssetAsText('cid-1', 'a.txt')).rejects.toThrow('Failed to read asset');
  });

  it('propagates idb read errors from getAsset and zips stored files', async () => {
    const fileReaderFactory = vi.fn(() => ({
      onload: null,
      readAsText: vi.fn(),
    }));
    const fileSpy = vi.spyOn(JSZip.prototype as any, 'file').mockReturnThis();
    const service = createService(
      {
        get: vi.fn().mockRejectedValue(new Error('idb read failed')),
        getAll: vi.fn().mockResolvedValue([
          { name: 'a.txt', content: 'a' },
          { name: 'b.txt', content: 'b' },
        ]),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { fileReaderFactory: fileReaderFactory as any }
    );

    await expect(service.getAssetAsText('cid-1', 'a.txt')).rejects.toThrow('idb read failed');

    await service.zip('cid-1');
    expect(fileSpy).toHaveBeenCalledWith('a.txt', expect.anything());
    expect(fileSpy).toHaveBeenCalledWith('b.txt', expect.anything());
    fileSpy.mockRestore();
  });

  it('returns false for non-current chains with empty stored event list', async () => {
    const service = createService(
      {
        hasStore: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue({ events: [] }),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );

    await expect(service.isCurrentEvent({ id: 'chain-1', events: [1] } as any)).resolves.toBe(false);
  });

  it('returns null from importFromRelay when all relay entries are invalid', async () => {
    const relay = {
      readAll: vi.fn().mockResolvedValue([null, { bad: true }]),
    };
    const service = createService(
      {} as any,
      relay as any,
      { get: () => [], set: () => undefined } as any
    );

    await expect(service.importFromRelay()).resolves.toBeNull();
  });

  it('sets triggerRefresh when relay package already exists in idb', async () => {
    const relay = {
      readAll: vi.fn().mockResolvedValue([
        { hash: 'h1', message: { data: { buffer: new Uint8Array([1]) }, timestamp: Date.now(), meta: {} } },
      ]),
      checkDuplicateMessage: vi.fn().mockImplementation(async (items: any[]) => items),
    };
    const service = createService(
      { hasStore: vi.fn().mockResolvedValue(true) } as any,
      relay as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([{ name: 'package.json' }]);
    vi.spyOn(service, 'processPackage').mockResolvedValue({ cid: 'cid-1', name: 'pkg' } as any);

    await expect(service.importFromRelay()).resolves.toEqual([[{ cid: 'cid-1', name: 'pkg' }], true]);
  });

  it('continues importFromRelay when a message fails processing', async () => {
    const relay = {
      readAll: vi.fn().mockResolvedValue([
        { hash: 'h1', message: { data: { buffer: new Uint8Array([1]) }, timestamp: Date.now(), meta: {} } },
      ]),
      checkDuplicateMessage: vi.fn().mockImplementation(async (items: any[]) => items),
    };
    const service = createService(
      { hasStore: vi.fn().mockResolvedValue(false) } as any,
      relay as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([{ name: 'package.json' }]);
    vi.spyOn(service, 'processPackage').mockRejectedValue(new Error('boom'));

    await expect(service.importFromRelay()).resolves.toEqual([[], false]);
  });

  it('treats missing stored chain as current event', async () => {
    const service = createService(
      {
        hasStore: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );

    await expect(service.isCurrentEvent({ id: 'chain-1', events: [1] } as any)).resolves.toBe(true);
  });

  it('covers constructor defaults and info uniqueMessageHash filtering', () => {
    const service = new PackageService(
      {} as any,
      {} as any,
      {
        get: () => [
          {
            title: 'Stored',
            name: 'stored',
            cid: 'cid-1',
            uniqueMessageHash: 'mh-1',
            versions: [{ date: new Date(), cid: 'cid-1', uniqueMessageHash: 'mh-1' }],
            ...capabilities,
          },
        ],
        set: () => undefined,
      } as any
    );

    expect(typeof (service as any).fetchFn).toBe('function');
    expect(typeof (service as any).fileReaderFactory).toBe('function');
    expect(service.info('cid-1', 'mh-1').name).toBe('stored');
    expect(() => service.info('cid-1', 'mh-missing')).toThrow('Package not found');
  });

  it('updates existing package info with new versions', () => {
    const localPackages: any[] = [
      {
        title: 'Pkg',
        name: 'pkg',
        cid: 'cid-1',
        keywords: ['old'],
        versions: [{ date: new Date(), cid: 'cid-1' }],
        ...capabilities,
      },
    ];
    const service = createService(
      {} as any,
      {} as any,
      {
        get: () => localPackages,
        set: (_k: string, v: any[]) => {
          localPackages.splice(0, localPackages.length, ...v);
        },
      } as any
    );

    const updated = (service as any).storePackageInfo(
      'Pkg',
      'pkg',
      'desc',
      'cid-1',
      ['new'],
      capabilities
    );
    expect(updated.description).toBe('desc');
    expect(updated.versions.length).toBe(2);
    expect(updated.keywords).toEqual(['new']);
  });

  it('extractAssets supports chain and non-chain modes with mime detection', async () => {
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
    const zip = new JSZip();
    zip.file('a.txt', 'A');
    zip.file('chain.json', '{"id":"c1","events":[]}');
    zip.file('.hidden', 'x');
    const zipFile = (await zip.generateAsync({ type: 'uint8array' })) as any;

    const noChain = await service.extractAssets(zipFile, false);
    expect(noChain.map((f) => f.name).sort()).toEqual(['a.txt']);

    const withChain = await service.extractAssets(zipFile, true);
    expect(withChain.map((f) => f.name).sort()).toEqual(['a.txt', 'chain.json']);
  });

  it('handles store and verification failures including quota errors', async () => {
    const idb = {
      hasStore: vi.fn().mockResolvedValue(false),
      createStore: vi.fn(),
      setAll: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
    };
    const service = createService(idb as any, {} as any, { get: () => [], set: () => undefined } as any);
    await expect(
      (service as any).storeAssets('cid-1', [new File(['x'], 'a.txt')])
    ).rejects.toThrow('was not created successfully');

    idb.setAll.mockRejectedValueOnce(Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' }));
    await expect(
      (service as any).storeAssets('cid-2', [new File(['x'], 'a.txt')])
    ).rejects.toThrow('Device storage quota exceeded');

    const serviceVerify = createService(
      { hasStore: vi.fn().mockResolvedValue(false), keys: vi.fn() } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );
    await expect((serviceVerify as any).verifyStoreExists('missing', 1)).rejects.toThrow(
      'was not created successfully'
    );

    const serviceQuota = createService(
      {
        hasStore: vi.fn().mockResolvedValue(true),
        keys: vi.fn().mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' })),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );
    await expect((serviceQuota as any).verifyStoreExists('s', 1)).rejects.toThrow(
      'Device storage quota exceeded'
    );

    const serviceGeneric = createService(
      {
        hasStore: vi.fn().mockResolvedValue(true),
        keys: vi.fn().mockRejectedValue(new Error('keys failed')),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );
    await expect((serviceGeneric as any).verifyStoreExists('s', 1)).rejects.toThrow(
      'keys failed'
    );
  });

  it('retries store verification with warnings and rethrows after final failure', async () => {
    const service = createService({} as any, {} as any, { get: () => [], set: () => undefined } as any);
    const verifySpy = vi
      .spyOn(service as any, 'verifyStoreExists')
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValueOnce(undefined);

    await expect(
      (service as any).retryStoreVerification('s', 1, 3, 0)
    ).resolves.toBeUndefined();
    expect(verifySpy).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalled();

    verifySpy.mockReset();
    verifySpy.mockRejectedValue(new Error('always-fail'));
    await expect((service as any).retryStoreVerification('s', 1, 2, 0)).rejects.toThrow(
      'always-fail'
    );
  });

  it('fails verification when stored file count is below expected', async () => {
    const service = createService(
      {
        hasStore: vi.fn().mockResolvedValue(true),
        keys: vi.fn().mockResolvedValue(['a.txt']),
      } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );

    await expect((service as any).verifyStoreExists('store', 2)).rejects.toThrow(
      'expected 2 files, found 1'
    );
  });

  it('throws for missing json files and missing package/chain in processPackage', async () => {
    const service = createService(
      { hasStore: vi.fn().mockResolvedValue(false) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any,
      { calculateCidFn: vi.fn().mockResolvedValue('cid-1') }
    );
    vi.spyOn(service, 'extractAssets').mockResolvedValue([] as any);
    await expect(service.getChainJson('chain.json', new File(['x'], 'x.zip'))).rejects.toThrow(
      'Invalid package: missing chain.json'
    );
    await expect((service as any).getPackageJson('package.json', [])).rejects.toThrow(
      'Invalid package: missing package.json'
    );
    await expect(
      (service as any).getPackageJson('package.json', [
        new File([JSON.stringify({ name: 'ok' })], 'package.json'),
      ])
    ).resolves.toEqual({ name: 'ok' });

    vi.spyOn(service as any, 'getPackageJson').mockResolvedValue(undefined);
    await expect(service.processPackage([{ name: 'package.json' }] as any)).rejects.toThrow(
      'Missing package.json'
    );

    (service as any).getPackageJson.mockResolvedValue({ name: 'pkg' });
    vi.spyOn(service as any, 'getChainJson').mockResolvedValue(undefined);
    await expect(
      service.processPackage({ data: { buffer: new Uint8Array([1]) } }, 'm1', true)
    ).rejects.toThrow('Missing chain.json for relay package');
  });

  it('attaches chain and message hash for relay packages', async () => {
    const idb = {
      hasStore: vi.fn().mockResolvedValue(false),
      createStore: vi.fn(),
      setAll: vi.fn(),
      keys: vi.fn().mockResolvedValue(['package.json']),
    };
    const local: any[] = [];
    const service = createService(
      idb as any,
      {} as any,
      {
        get: () => local,
        set: (_k: string, v: any[]) => {
          local.splice(0, local.length, ...v);
        },
      } as any,
      { calculateCidFn: vi.fn().mockResolvedValue('cid-relay') }
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([new File(['{}'], 'package.json')] as any);
    vi.spyOn(service as any, 'getPackageJson').mockResolvedValue({ name: 'relay-pkg', keywords: [] });
    vi.spyOn(service as any, 'getChainJson').mockResolvedValue({ id: 'chain-1', events: [] });
    vi.spyOn(service as any, 'getCapabilities').mockResolvedValue(capabilities);
    vi.spyOn(service as any, 'storeAssets').mockResolvedValue(undefined);
    const fromSpy = vi.spyOn(EventChain, 'from').mockReturnValue({ id: 'chain-1' } as any);

    const pkg = await service.processPackage(
      { data: { buffer: new Uint8Array([1]) } },
      'mh-1',
      true
    );
    expect(pkg?.chain).toEqual({ id: 'chain-1' });
    expect(pkg?.uniqueMessageHash).toBe('mh-1');
    fromSpy.mockRestore();
  });

  it('covers import verification fallback paths', async () => {
    const service = createService(
      { hasStore: vi.fn().mockResolvedValue(false) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service, 'extractAssets').mockResolvedValue([new File(['x'], 'a.txt')] as any);
    vi.spyOn(service, 'processPackage').mockResolvedValue({ cid: 'cid-1' } as any);
    const retrySpy = vi.spyOn(service as any, 'retryStoreVerification').mockRejectedValue(new Error('retry fail'));

    await expect(service.import(new File(['x'], 'x.zip'))).resolves.toEqual({ cid: 'cid-1' });
    expect(retrySpy).toHaveBeenCalled();

    const service2 = createService(
      { hasStore: vi.fn().mockResolvedValue(true) } as any,
      {} as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service2, 'extractAssets').mockResolvedValue([new File(['x'], 'a.txt')] as any);
    vi.spyOn(service2, 'processPackage').mockResolvedValue({ cid: 'cid-2' } as any);
    vi.spyOn(service2 as any, 'verifyStoreExists').mockRejectedValue(new Error('verify fail'));
    const retrySpy2 = vi.spyOn(service2 as any, 'retryStoreVerification').mockResolvedValue(undefined);

    await expect(service2.import(new File(['x'], 'y.zip'))).resolves.toEqual({ cid: 'cid-2' });
    expect(retrySpy2).toHaveBeenCalled();

    retrySpy2.mockReset();
    retrySpy2.mockRejectedValue(new Error('retry explode'));
    await expect(service2.import(new File(['x'], 'z.zip'))).resolves.toEqual({ cid: 'cid-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logger.error).toHaveBeenCalledWith(
      'Background store verification failed after retries:',
      expect.any(Error)
    );
  });

  it('handles relay import entries with empty extracted assets or undefined pkg', async () => {
    const relay = {
      readAll: vi.fn().mockResolvedValue([
        { hash: 'h1', message: { data: { buffer: new Uint8Array([1]) }, timestamp: Date.now(), meta: {} } },
      ]),
      checkDuplicateMessage: vi.fn().mockImplementation(async (items: any[]) => items),
    };
    const service = createService(
      { hasStore: vi.fn().mockResolvedValue(false) } as any,
      relay as any,
      { get: () => [], set: () => undefined } as any
    );
    vi.spyOn(service as any, 'extractAssets').mockResolvedValue([] as any);
    vi.spyOn(service, 'processPackage').mockResolvedValue(undefined as any);

    await expect(service.importFromRelay()).resolves.toEqual([[], false]);
  });

});
