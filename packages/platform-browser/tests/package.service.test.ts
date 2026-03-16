import { describe, expect, it } from 'vitest';

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
});
