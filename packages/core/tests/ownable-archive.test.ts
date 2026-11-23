import { BlackHoleBlockstore } from 'blockstore-core';
import { Binary, Event, EventChain } from 'eqty-core';
import { importer } from 'ipfs-unixfs-importer';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import {
  assertAttachmentCid,
  calculateAttachmentCid,
  collectOwnableAttachments,
  createConsumptionSnapshot,
  readConsumptionSnapshot,
  readOwnableBundleArchive,
  serializeOwnableChain,
  splitOwnableArchiveEntries,
} from '../src/utils/ownableArchive.js';

const issuer = '0x1111111111111111111111111111111111111111';
const encode = (text: string) => new TextEncoder().encode(text);

function dossierEvent(cid: string): Event {
  return new Event({
    '@context': 'execute_msg.json',
    attach: { attachments: [{ cid, name: 'file.txt' }] },
  });
}

function ingestEvent(cid: string): Event {
  return new Event({ '@context': 'ingest_msg.json', type: 'consume', source: { cid } });
}

function chainWith(...events: Event[]): EventChain {
  const chain = EventChain.create(issuer, 84532);
  for (const event of events) {
    chain.add(event);
    event.signerAddress = issuer;
    event.timestamp = 1_000;
    event.signature = Binary.fromHex(`0x${'11'.repeat(65)}`);
  }
  return chain;
}

function packageZip(): JSZip {
  return new JSZip().file('contract.wasm', new Uint8Array([1, 2, 3]));
}

describe('Ownable archive attachments', () => {
  it('keeps the existing Dossier file CIDs for single-block and multi-block files', async () => {
    for (const bytes of [new Uint8Array(), encode('hello'), new Uint8Array(600_000).fill(37)]) {
      const cids = [];
      for await (const { cid } of importer(
        [{ path: 'file.txt', content: bytes }],
        new BlackHoleBlockstore()
      )) {
        cids.push(cid.toString());
      }
      await expect(calculateAttachmentCid(bytes)).resolves.toBe(cids[0]);
    }
  });

  it('partitions runtime files, chain and flat attachments without accepting reserved aliases', async () => {
    const bytes = encode('hello');
    const cid = await calculateAttachmentCid(bytes);
    const assets = new Map([['package/contract.wasm', bytes]]);
    expect(
      splitOwnableArchiveEntries([
        ['eventChain.json', bytes],
        ['chain.json', bytes],
        [`attachments/${cid}`, bytes],
        ...assets,
      ])
    ).toEqual({ chain: bytes, attachments: new Map([[cid, bytes]]), assets });
    expect(() => splitOwnableArchiveEntries([['attachments/sub/nested.zip', bytes]])).toThrow(
      'Invalid attachment CID'
    );
    expect(() => splitOwnableArchiveEntries([['../chain.json', bytes]])).toThrow(
      'Invalid Ownable archive path'
    );
    expect(() =>
      splitOwnableArchiveEntries([
        ['eventChain.json', bytes],
        ['chain.json', encode('different')],
      ])
    ).toThrow('Conflicting Ownable chain files');
  });

  it('bounds decompression across all files in an outer bundle', async () => {
    const attachment = new Uint8Array(1_024);
    const cid = await calculateAttachmentCid(attachment);
    const zip = packageZip().file('chain.json', '{}').file(`attachments/${cid}`, attachment);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const blob = new Blob([bytes]);

    await expect(readOwnableBundleArchive(blob, { maxExpandedBytes: 1_028 })).rejects.toThrow(
      'exceeds its expanded size limit'
    );
    const bundle = await readOwnableBundleArchive(blob, { maxExpandedBytes: 1_029 });
    expect(bundle.attachments.get(cid)).toEqual(attachment);
    expect(bundle.assets.get('contract.wasm')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('relocates only legacy Dossier attachments named in the event body and preserves its hash', async () => {
    const bytes = encode('hello');
    const cid = await calculateAttachmentCid(bytes);
    const unrelatedCid = await calculateAttachmentCid(encode('unrelated'));
    const event = dossierEvent(cid);
    event.addAttachment(cid, bytes);
    event.addAttachment(unrelatedCid, encode('unrelated'));
    const chain = chainWith(event);
    const serialized = serializeOwnableChain(chain);
    const read = vi.fn(async () => undefined);

    expect(serialized.events[0]).not.toHaveProperty('attachments');
    const restored = EventChain.from(serialized).events[0];
    expect(restored?.hash.hex).toBe(event.hash.hex);
    expect(restored?.signature?.hex).toBe(event.signature?.hex);
    await expect(collectOwnableAttachments(chain, read)).resolves.toEqual(new Map([[cid, bytes]]));
    expect(read).not.toHaveBeenCalled();
  });

  it('flattens nested proof snapshots and stores a shared file once', async () => {
    const file = encode('shared Dossier file');
    const cid = await calculateAttachmentCid(file);
    const dossier = dossierEvent(cid);
    dossier.addAttachment(cid, file);
    const suppliedPackage = packageZip().file(`attachments/${cid}`, file).file('chain.json', '{}');
    const nested = await createConsumptionSnapshot(chainWith(dossier), suppliedPackage);
    const parent = await createConsumptionSnapshot(
      chainWith(ingestEvent(nested.cid)),
      packageZip()
    );
    const outer = chainWith(dossierEvent(cid), ingestEvent(parent.cid));
    const storage = new Map([
      [cid, file],
      [nested.cid, nested.bytes],
      [parent.cid, parent.bytes],
    ]);
    const read = vi.fn(async (key: string) => storage.get(key));
    const rawSnapshot = await JSZip.loadAsync(nested.bytes);

    expect(Object.keys(rawSnapshot.files)).toEqual(['contract.wasm', 'chain.json']);
    expect(
      JSON.parse(await rawSnapshot.file('chain.json')!.async('string')).events[0]
    ).not.toHaveProperty('attachments');
    expect(await collectOwnableAttachments(outer, read)).toEqual(storage);
    expect(read.mock.calls).toEqual([[cid], [parent.cid], [nested.cid]]);

    storage.delete(nested.cid);
    await expect(collectOwnableAttachments(outer, read)).rejects.toThrow(
      `Missing attachment ${nested.cid}`
    );
    storage.set(nested.cid, encode('tampered'));
    await expect(collectOwnableAttachments(outer, read)).rejects.toThrow(
      `Attachment bytes do not match CID ${nested.cid}`
    );
  });

  it('rejects unsigned inline attachments that do not match their signed CID', async () => {
    const bytes = encode('verified content');
    const cid = await calculateAttachmentCid(bytes);
    const event = dossierEvent(cid);
    event.addAttachment(cid, encode('wrong content'));
    await expect(collectOwnableAttachments(chainWith(event), async () => bytes)).rejects.toThrow(
      'bytes do not match CID'
    );
    await expect(assertAttachmentCid(cid, bytes)).resolves.toBeUndefined();
  });

  it('requires inline historical bytes to be backed by a Dossier reference', async () => {
    const snapshot = await createConsumptionSnapshot(chainWith(), packageZip());
    const event = ingestEvent(snapshot.cid);
    event.addAttachment(snapshot.cid, snapshot.bytes);
    await expect(
      collectOwnableAttachments(chainWith(event), async () => undefined)
    ).rejects.toThrow(`Missing attachment ${snapshot.cid}`);
  });

  it('requires full chains in snapshots', async () => {
    const chain = chainWith(new Event({ action: 'create' }), new Event({ action: 'consume' }));
    const partial = chain.startingAfter(chain.events[0]!);
    await expect(createConsumptionSnapshot(partial, packageZip())).rejects.toThrow(
      'requires a complete chain'
    );

    const zip = packageZip().file('chain.json', JSON.stringify(serializeOwnableChain(partial)));
    await expect(
      readConsumptionSnapshot(await zip.generateAsync({ type: 'uint8array' }))
    ).rejects.toThrow('requires a complete chain');
  });

  it('bounds streamed expansion and rejects nested attachment bytes inside proof archives', async () => {
    const chain = chainWith();
    const expanded = new JSZip()
      .file('payload', new Uint8Array(20_000))
      .file('chain.json', JSON.stringify(chain));
    const compressed = await expanded.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(readConsumptionSnapshot(compressed, { maxExpandedBytes: 100 })).rejects.toThrow(
      'expanded size limit'
    );

    expanded.file('attachments/file', 'unexpected');
    await expect(
      readConsumptionSnapshot(await expanded.generateAsync({ type: 'uint8array' }))
    ).rejects.toThrow('Unexpected entry in consumption snapshot');
  });
});
