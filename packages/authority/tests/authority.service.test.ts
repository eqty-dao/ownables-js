import { describe, expect, it } from 'vitest';

import AuthorityService from '../src/services/Authority.service';

class InMemoryRecordStore {
  private readonly byCid = new Map<string, any>();
  private readonly byNft = new Map<string, string>();

  private nftKey(nft: { network: string; address: string; id: string }): string {
    return `${nft.network}|${nft.address.toLowerCase()}|${nft.id}`;
  }

  async put(record: any): Promise<void> {
    this.byCid.set(record.cid, record);
    this.byNft.set(this.nftKey(record.nft), record.cid);
  }

  async getByCid(cid: string): Promise<any> {
    return this.byCid.get(cid);
  }

  async hasCid(cid: string): Promise<boolean> {
    return this.byCid.has(cid);
  }

  async getCidByNft(nft: any): Promise<string | undefined> {
    return this.byNft.get(this.nftKey(nft));
  }

  async getByNft(nft: any): Promise<any> {
    const cid = this.byNft.get(this.nftKey(nft));
    return cid ? this.byCid.get(cid) : undefined;
  }

  async listByPrevOwner(prevOwner: string): Promise<any[]> {
    return Array.from(this.byCid.values()).filter(
      (record) => record.prevOwner.toLowerCase() === prevOwner.toLowerCase()
    );
  }
}

function makeArchiveService() {
  const packages = new Set<string>();
  const chains = new Map<string, Record<string, unknown>>();

  return {
    service: {
      importArchive: async () => {
        const cid = 'cid-1';
        packages.add(cid);
        const chainJson = {
          events: [
            { parsedData: { nft: { network: 'eip155:base', address: '0xabc', id: '1' } } },
            { signerAddress: 'lto-prev-owner' },
          ],
        };
        chains.set(cid, chainJson);

        return {
          cid,
          chainJson,
          chainFileName: 'eventChain.json' as const,
          packageFiles: ['ownable.js'],
        };
      },
      hasPackage: async (cid: string) => packages.has(cid),
      hasChain: async (cid: string) => chains.has(cid),
      readChain: async (cid: string) => chains.get(cid)!,
      readPackageZip: async () => Uint8Array.from([1, 2, 3]),
    },
  };
}

describe('AuthorityService', () => {
  it('bridges archive and stores record with unlock proof', async () => {
    const { service: archive } = makeArchiveService();
    const lockable = {
      getOwner: async () => '0xowner',
      isLocked: async () => true,
      getUnlockChallenge: async () => `0x${'1'.repeat(64)}`,
      signUnlockChallenge: async () => '0xproof',
      isUnlockProofValid: async () => true,
    };

    const authority = new AuthorityService(new InMemoryRecordStore() as any, archive as any, lockable as any);

    const result = await authority.bridgeOwnableArchive(Uint8Array.from([1, 2, 3]));

    expect(result.cid).toBe('cid-1');
    expect(result.prevOwner).toBe('lto-prev-owner');
    expect(result.proof).toBe('0xproof');
  });

  it('enforces lock and owner checks on getUnlockProof', async () => {
    const { service: archive } = makeArchiveService();
    const store = new InMemoryRecordStore();
    await archive.importArchive(Uint8Array.from([1]));

    await store.put({
      cid: 'cid-1',
      prevOwner: 'lto-prev-owner',
      nft: { network: 'eip155:base', address: '0xabc', id: '1' },
      createdAt: new Date().toISOString(),
    });

    const authority = new AuthorityService(
      store as any,
      archive as any,
      {
        getOwner: async () => '0xowner',
        isLocked: async () => true,
        getUnlockChallenge: async () => `0x${'2'.repeat(64)}`,
        signUnlockChallenge: async () => '0xproof-2',
        isUnlockProofValid: async () => true,
      } as any
    );

    await expect(authority.getUnlockProof('cid-1', '0xowner')).resolves.toBe('0xproof-2');
    await expect(authority.getUnlockProof('cid-1', '0xnot-owner')).rejects.toThrow(/not current NFT owner/i);
  });

  it('throws when archive import fails', async () => {
    const authority = new AuthorityService(
      new InMemoryRecordStore() as any,
      {
        importArchive: async () => {
          throw new Error('bad archive');
        },
      } as any,
      {} as any
    );

    await expect(authority.bridgeOwnableArchive(Uint8Array.from([1]))).rejects.toThrow('bad archive');
  });

  it('throws when NFT is not locked or record/package missing', async () => {
    const { service: archive } = makeArchiveService();
    const store = new InMemoryRecordStore();
    const authority = new AuthorityService(
      store as any,
      archive as any,
      {
        getOwner: async () => '0xowner',
        isLocked: async () => false,
        getUnlockChallenge: async () => '0x1',
        signUnlockChallenge: async () => '0xproof',
        isUnlockProofValid: async () => true,
      } as any
    );

    await expect(authority.getUnlockProof('missing')).rejects.toThrow('CID not found');

    await store.put({
      cid: 'cid-missing-pkg',
      prevOwner: 'lto-prev-owner',
      nft: { network: 'eip155:base', address: '0xabc', id: '1' },
      createdAt: new Date().toISOString(),
    });
    await expect(authority.getUnlockProof('cid-missing-pkg')).rejects.toThrow('Ownable package with CID is not available');
  });

  it('reads CID lookup and validates proof through gateway', async () => {
    const { service: archive } = makeArchiveService();
    const store = new InMemoryRecordStore();
    await store.put({
      cid: 'cid-2',
      prevOwner: '0xprev',
      nft: { network: 'eip155:base', address: '0xabc', id: '1' },
      createdAt: new Date().toISOString(),
    });
    const authority = new AuthorityService(
      store as any,
      archive as any,
      {
        getOwner: async () => '0xowner',
        isLocked: async () => true,
        getUnlockChallenge: async () => '0x1',
        signUnlockChallenge: async () => '0xproof',
        isUnlockProofValid: async () => true,
      } as any
    );

    await expect(
      authority.getOwnableCidFromNFT({ network: 'eip155:base', address: '0xabc', id: '1' })
    ).resolves.toEqual(
      expect.objectContaining({
        ownableCid: 'cid-2',
        ownableLastOwner: '0xprev',
        nftOwner: '0xowner',
      })
    );
    await expect(authority.isUnlockProofValid('eip155:base', '0xabc', '1', '0xproof')).resolves.toBe(true);
    await expect(
      authority.getOwnableCidFromNFT({ network: 'eip155:base', address: '0xdef', id: '2' })
    ).rejects.toThrow('No CID available');
  });

  it('supports parsedData string/base64 and explicit signerAddress override', async () => {
    const store = new InMemoryRecordStore();
    const archive = {
      importArchive: async () => ({
        cid: 'cid-str',
        chainJson: {
          events: [
            {
              parsedData: JSON.stringify({
                nft: { network: 'eip155:base', address: '0xabc', id: '1' },
              }),
            },
            {},
          ],
        },
      }),
      hasPackage: async () => true,
    };
    const lockable = {
      getUnlockChallenge: async () => `0x${'1'.repeat(64)}`,
      signUnlockChallenge: async () => '0xproof',
      isLocked: async () => true,
      getOwner: async () => '0xowner',
      isUnlockProofValid: async () => true,
    };
    const authority = new AuthorityService(
      store as any,
      archive as any,
      lockable as any,
      { now: () => new Date('2026-03-18T12:00:00.000Z') }
    );

    const bridged = await authority.bridgeOwnableArchive(Uint8Array.from([1]), '0xSigner');
    expect(bridged.prevOwner).toBe('0xSigner');

    const archiveB64 = {
      importArchive: async () => ({
        cid: 'cid-b64',
        chainJson: {
          events: [
            {
              parsedData: Buffer.from(
                JSON.stringify({
                  nft: { network: 'eip155:base', address: '0xdef', id: '2' },
                }),
                'utf8'
              ).toString('base64'),
            },
            { signer: '0xprev' },
          ],
        },
      }),
      hasPackage: async () => true,
    };
    const authorityB64 = new AuthorityService(
      store as any,
      archiveB64 as any,
      lockable as any
    );
    await expect(authorityB64.bridgeOwnableArchive(Uint8Array.from([2]))).resolves.toEqual(
      expect.objectContaining({ cid: 'cid-b64' })
    );
  });

  it('throws for missing nft fields and invalid previous owner derivation', async () => {
    const authority = new AuthorityService(
      new InMemoryRecordStore() as any,
      {
        importArchive: async () => ({
          cid: 'cid-1',
          chainJson: { events: [{ parsedData: { nft: { network: 'x', address: '0xabc' } } }] },
        }),
      } as any,
      {} as any
    );
    await expect(authority.bridgeOwnableArchive(Uint8Array.from([1]))).rejects.toThrow(
      'Unable to find nft info'
    );

    const authorityNoEvents = new AuthorityService(
      new InMemoryRecordStore() as any,
      {
        importArchive: async () => ({
          cid: 'cid-2',
          chainJson: {
            events: [
              { parsedData: { nft: { network: 'x', address: '0xabc', id: '1' } } },
            ],
          },
        }),
      } as any,
      {} as any
    );
    await expect(authorityNoEvents.bridgeOwnableArchive(Uint8Array.from([1]))).rejects.toThrow(
      'Cannot derive previous owner'
    );
  });

  it('throws when event chain has no events', async () => {
    const authority = new AuthorityService(
      new InMemoryRecordStore() as any,
      {
        importArchive: async () => ({
          cid: 'cid-empty',
          chainJson: { events: [] },
        }),
      } as any,
      {} as any
    );

    await expect(authority.bridgeOwnableArchive(Uint8Array.from([1]))).rejects.toThrow(
      'Unable to find nft info'
    );
  });

  it('handles malformed parsedData payloads gracefully', async () => {
    const authority = new AuthorityService(
      new InMemoryRecordStore() as any,
      {
        importArchive: async () => ({
          cid: 'cid-bad',
          chainJson: { events: [{ parsedData: '%%%NOT_JSON%%%' }] },
        }),
      } as any,
      {} as any
    );

    await expect(authority.bridgeOwnableArchive(Uint8Array.from([1]))).rejects.toThrow(
      'Unable to find nft info'
    );
  });

  it('throws NFT_NOT_LOCKED when getUnlockProof checks unlocked nft', async () => {
    const store = new InMemoryRecordStore();
    await store.put({
      cid: 'cid-unlocked',
      prevOwner: '0xprev',
      nft: { network: 'eip155:base', address: '0xabc', id: '1' },
      createdAt: new Date().toISOString(),
    });
    const authority = new AuthorityService(
      store as any,
      { hasPackage: async () => true } as any,
      {
        isLocked: async () => false,
      } as any
    );

    await expect(authority.getUnlockProof('cid-unlocked')).rejects.toThrow(
      'is not locked on'
    );
  });
});
