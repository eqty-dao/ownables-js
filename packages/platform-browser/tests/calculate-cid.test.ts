import { describe, expect, it } from 'vitest';

import { OwnablePackageCidService } from '@ownables/core';

const calculateCid = async (files: File[]) =>
  new OwnablePackageCidService().calculate(
    await Promise.all(
      files.map(async (file) => ({
        path: file.name,
        content: new Uint8Array(await file.arrayBuffer()),
      }))
    )
  );

describe('calculateCid', () => {
  it('ignores chain.json and timestamp.txt when calculating package cid', async () => {
    const packageFiles = [
      new File(['alpha'], 'a.txt', { type: 'text/plain' }),
      new File(['beta'], 'b.txt', { type: 'text/plain' }),
    ];
    const withMeta = [
      ...packageFiles,
      new File(['{"events":[]}'], 'chain.json', { type: 'application/json' }),
      new File(['2026-01-01T00:00:00.000Z'], 'timestamp.txt', {
        type: 'text/plain',
      }),
    ];

    const cidWithoutMeta = await calculateCid(packageFiles);
    const cidWithMeta = await calculateCid(withMeta);

    expect(cidWithMeta).toBe(cidWithoutMeta);
  });

  it('throws when importer cannot produce a package directory cid', async () => {
    const metaOnly = [
      new File(['{"events":[]}'], 'chain.json', { type: 'application/json' }),
      new File(['2026-01-01T00:00:00.000Z'], 'timestamp.txt', {
        type: 'text/plain',
      }),
    ];

    await expect(calculateCid(metaOnly)).rejects.toThrow('Failed to calculate directory CID');
  });
});
