import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import BucketArchiveService from '../src/services/BucketArchive.service';

class InMemoryBucket {
  private readonly map = new Map<string, Uint8Array>();

  async list(): Promise<string[]> {
    return Array.from(this.map.keys());
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.map.get(key);
  }

  async put(key: string, value: Uint8Array | Buffer | string): Promise<void> {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    this.map.set(key, Uint8Array.from(bytes));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function cidCalculator(files: Map<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const [name, bytes] of files.entries()) {
    hash.update(name);
    hash.update(bytes);
  }
  return `cid-${hash.digest('hex').slice(0, 16)}`;
}

async function makeArchive(chainFileName: 'eventChain.json' | 'chain.json'): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('ownable.js', 'console.log("ok")');
  zip.file(chainFileName, JSON.stringify({ events: [{ parsedData: { nft: { network: 'eip155:base', address: '0xabc', id: '1' } } }] }));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('BucketArchiveService', () => {
  it('imports archive, strips chain file from package zip and persists chain separately', async () => {
    const service = new BucketArchiveService({
      bucket: new InMemoryBucket() as any,
      cidCalculator: { calculate: cidCalculator },
    });

    const result = await service.importArchive(await makeArchive('eventChain.json'));

    expect(result.packageFiles).toEqual(['ownable.js']);
    await expect(service.hasPackage(result.cid)).resolves.toBe(true);
    await expect(service.hasChain(result.cid)).resolves.toBe(true);

    const packageZip = await service.readPackageZip(result.cid);
    const zip = await new JSZip().loadAsync(packageZip);

    expect(Object.keys(zip.files)).toEqual(['ownable.js']);
    await expect(service.readChain(result.cid)).resolves.toEqual(result.chainJson);
  });

  it('normalizes chain.json and eventChain.json inputs to same cid', async () => {
    const service = new BucketArchiveService({
      bucket: new InMemoryBucket() as any,
      cidCalculator: { calculate: cidCalculator },
    });

    const fromEventChain = await service.importArchive(await makeArchive('eventChain.json'));
    const fromChain = await service.importArchive(await makeArchive('chain.json'));

    expect(fromEventChain.cid).toBe(fromChain.cid);
  });

  it('rejects archives without chain file', async () => {
    const zip = new JSZip();
    zip.file('ownable.js', 'console.log("ok")');

    const service = new BucketArchiveService({
      bucket: new InMemoryBucket() as any,
      cidCalculator: { calculate: cidCalculator },
    });

    await expect(service.importArchive(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /eventChain\.json' or 'chain\.json/
    );
  });
});
