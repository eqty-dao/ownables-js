import { describe, expect, it } from 'vitest';

import {
  calculateOwnablePackageCid,
  type OwnablePackageCidEntry,
} from '@ownables/core/utils';

describe('calculateOwnablePackageCid', () => {
  it('normalizes and sorts paths while excluding package metadata', async () => {
    const canonical: OwnablePackageCidEntry[] = [
      { path: 'a.txt', content: Uint8Array.from([1]) },
      { path: 'nested/b.txt', content: Uint8Array.from([2]) },
    ];
    const alternate: OwnablePackageCidEntry[] = [
      { path: 'timestamp.txt', content: Uint8Array.from([4]) },
      { path: './nested\\b.txt', content: Uint8Array.from([2]) },
      { path: '/a.txt', content: Uint8Array.from([1]) },
      { path: './chain.json', content: Uint8Array.from([3]) },
    ];

    await expect(calculateOwnablePackageCid(alternate)).resolves.toBe(
      await calculateOwnablePackageCid(canonical)
    );
  });

  it('preserves the failure when only excluded metadata remains', async () => {
    await expect(
      calculateOwnablePackageCid([
        { path: 'chain.json', content: Uint8Array.from([1]) },
        { path: 'timestamp.txt', content: Uint8Array.from([2]) },
      ])
    ).rejects.toThrow(
      'Failed to calculate directory CID: importer did not find a directory entry in the input files'
    );
  });
});
