import { describe, expect, it } from 'vitest';

import { calculateOwnablePackageCid } from '@ownables/core/utils';

const calculateFromFiles = async (files: File[]) =>
  calculateOwnablePackageCid(
    await Promise.all(
      files.map(async (file) => ({
        path: file.name,
        content: new Uint8Array(await file.arrayBuffer()),
      }))
    )
  );

describe('calculateOwnablePackageCid', () => {
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

    const cidWithoutMeta = await calculateFromFiles(packageFiles);
    const cidWithMeta = await calculateFromFiles(withMeta);

    expect(cidWithMeta).toBe(cidWithoutMeta);
  });

  it('throws when importer cannot produce a package directory cid', async () => {
    const metaOnly = [
      new File(['{"events":[]}'], 'chain.json', { type: 'application/json' }),
      new File(['2026-01-01T00:00:00.000Z'], 'timestamp.txt', {
        type: 'text/plain',
      }),
    ];

    await expect(calculateFromFiles(metaOnly)).rejects.toThrow(
      'Failed to calculate directory CID'
    );
  });
});
