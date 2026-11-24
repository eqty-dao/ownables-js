import { BlackHoleBlockstore } from 'blockstore-core';
import { EventChain, type IEventChainJSON } from 'eqty-core';
import { importer } from 'ipfs-unixfs-importer';
import { fixedSize } from 'ipfs-unixfs-importer/chunker';
import { balanced } from 'ipfs-unixfs-importer/layout';
import JSZip from 'jszip';

export const OWNABLE_ATTACHMENT_PREFIX = 'attachments/';
const CHAIN_PATH = 'chain.json';
const LEGACY_CHAIN_PATH = 'eventChain.json';
const DEFAULT_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_SNAPSHOT_DEPTH = 16;

export interface OwnableArchiveEntries {
  assets: Map<string, Uint8Array>;
  chain?: Uint8Array;
  attachments: Map<string, Uint8Array>;
}

export interface ConsumptionSnapshotLimits {
  maxExpandedBytes?: number;
}

export interface ConsumptionSnapshot {
  chain: EventChain;
  assets: Map<string, Uint8Array>;
  expandedBytes: number;
}

export async function calculateAttachmentCid(bytes: Uint8Array): Promise<string> {
  // These are the UnixFS settings originally used for Dossier uploads.
  for await (const entry of importer([{ content: bytes }], new BlackHoleBlockstore(), {
    cidVersion: 1,
    rawLeaves: true,
    reduceSingleLeafToSelf: true,
    wrapWithDirectory: false,
    chunker: fixedSize({ chunkSize: 262_144 }),
    layout: balanced({ maxChildrenPerNode: 174 }),
  })) {
    return entry.cid.toString();
  }
  throw new Error('Could not calculate attachment CID');
}

function assertCidFormat(cid: string): void {
  if (!/^b[a-z2-7]{58}$/.test(cid)) {
    throw new Error(`Invalid attachment CID: ${cid}`);
  }
}

export async function assertAttachmentCid(cid: string, bytes: Uint8Array): Promise<void> {
  assertCidFormat(cid);
  if ((await calculateAttachmentCid(bytes)) !== cid) {
    throw new Error(`Attachment bytes do not match CID ${cid}`);
  }
}

export function serializeOwnableChain(chain: EventChain): IEventChainJSON {
  const json = chain.toJSON();
  for (const event of json.events) {
    if ('attachments' in event) delete event.attachments;
  }
  return json;
}

function assertArchivePath(path: string): void {
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid Ownable archive path: ${path}`);
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function splitOwnableArchiveEntries(
  entries: Iterable<[string, Uint8Array]>
): OwnableArchiveEntries {
  const assets = new Map<string, Uint8Array>();
  const attachments = new Map<string, Uint8Array>();
  const paths = new Set<string>();
  let chain: Uint8Array | undefined;
  for (const [path, bytes] of entries) {
    assertArchivePath(path);
    if (paths.has(path)) throw new Error(`Duplicate Ownable archive path: ${path}`);
    paths.add(path);
    if (path === CHAIN_PATH || path === LEGACY_CHAIN_PATH) {
      if (chain && !equalBytes(bytes, chain)) throw new Error('Conflicting Ownable chain files');
      chain = bytes;
    } else if (path.startsWith(OWNABLE_ATTACHMENT_PREFIX)) {
      const cid = path.slice(OWNABLE_ATTACHMENT_PREFIX.length);
      assertCidFormat(cid);
      attachments.set(cid, bytes);
    } else if (path === 'attachments') {
      throw new Error('The attachments archive path is reserved');
    } else {
      assets.set(path, bytes);
    }
  }
  return { assets, attachments, ...(chain ? { chain } : {}) };
}

interface StreamingZipFile extends JSZip.JSZipObject {
  // JSZip's browser-compatible file stream is present at runtime but missing from its types.
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
}

function readZipFile(file: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const stream = (file as StreamingZipFile).internalStream('uint8array');
    const chunks: Uint8Array[] = [];
    let length = 0;
    stream
      .on('data', (chunk) => {
        length += chunk.byteLength;
        if (length > maxBytes) {
          stream.pause();
          reject(new Error('Ownable archive exceeds its expanded size limit'));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', reject)
      .on('end', () => {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(bytes);
      })
      .resume();
  });
}

async function readZipEntries(
  zip: JSZip,
  maxBytes: number,
  mode: 'bundle' | 'chain' | 'snapshot' | 'package'
) {
  const files = Object.values(zip.files);
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new Error('Too many entries in Ownable archive');

  const entries = new Map<string, Uint8Array>();
  let expandedBytes = 0;
  for (const file of files) {
    if (file.dir) continue;
    if (mode === 'bundle' && file.name.startsWith('.')) continue;
    const path = file.unsafeOriginalName ?? file.name;
    assertArchivePath(path);
    const isAttachment = path === 'attachments' || path.startsWith(OWNABLE_ATTACHMENT_PREFIX);
    const isChain = path === CHAIN_PATH || path === LEGACY_CHAIN_PATH;
    if (mode === 'chain' && !isChain) continue;
    if (mode === 'package' && (isAttachment || isChain)) continue;
    if (mode === 'snapshot' && (isAttachment || path === LEGACY_CHAIN_PATH)) {
      throw new Error(`Unexpected entry in consumption snapshot: ${path}`);
    }
    const bytes = await readZipFile(file, maxBytes - expandedBytes);
    entries.set(path, bytes);
    expandedBytes += bytes.byteLength;
  }
  return { ...splitOwnableArchiveEntries(entries), expandedBytes };
}

export async function readOwnableBundleArchive(
  input: Blob | Uint8Array | ArrayBuffer,
  options: ConsumptionSnapshotLimits & { chainOnly?: boolean } = {}
): Promise<OwnableArchiveEntries> {
  const inputSize = 'byteLength' in input ? input.byteLength : input.size;
  if (inputSize > DEFAULT_MAX_EXPANDED_BYTES) {
    throw new Error('Ownable archive is too large');
  }
  const zip = await JSZip.loadAsync('byteLength' in input ? input : await input.arrayBuffer());
  const { assets, chain, attachments } = await readZipEntries(
    zip,
    options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
    options.chainOnly ? 'chain' : 'bundle'
  );
  return { assets, attachments, ...(chain ? { chain } : {}) };
}

export async function createConsumptionSnapshot(
  chain: EventChain,
  packageZip: JSZip
): Promise<{ cid: string; bytes: Uint8Array }> {
  if (chain.isPartial()) throw new Error('Consumption snapshot requires a complete chain');
  const serializedChain = JSON.stringify(serializeOwnableChain(chain));
  const chainLength = new TextEncoder().encode(serializedChain).byteLength;
  if (chainLength > DEFAULT_MAX_EXPANDED_BYTES)
    throw new Error('Consumption snapshot chain is too large');
  const { assets } = await readZipEntries(
    packageZip,
    DEFAULT_MAX_EXPANDED_BYTES - chainLength,
    'package'
  );
  const zip = new JSZip();
  const date = new Date('1980-01-01T00:00:00Z');
  for (const path of [...assets.keys()].sort()) {
    zip.file(path, assets.get(path)!, { date, createFolders: false });
  }
  zip.file(CHAIN_PATH, serializedChain, { date });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  if (bytes.byteLength > DEFAULT_MAX_EXPANDED_BYTES)
    throw new Error('Consumption snapshot is too large');
  return { cid: await calculateAttachmentCid(bytes), bytes };
}

export async function readConsumptionSnapshot(
  bytes: Uint8Array,
  limits: ConsumptionSnapshotLimits = {}
): Promise<ConsumptionSnapshot> {
  if (bytes.byteLength > DEFAULT_MAX_EXPANDED_BYTES)
    throw new Error('Consumption snapshot is too large');
  const zip = await JSZip.loadAsync(bytes);
  const { assets, chain, expandedBytes } = await readZipEntries(
    zip,
    limits.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
    'snapshot'
  );
  if (!chain) throw new Error('Consumption snapshot is missing chain.json');
  const json = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chain)));
  if (
    typeof json?.id !== 'string' ||
    !Array.isArray(json.events) ||
    json.events.some((event) => !record(event))
  ) {
    throw new Error('Invalid consumption snapshot chain');
  }
  if (json.events.some((event) => 'attachments' in event)) {
    throw new Error('Consumption snapshot chain contains inline attachments');
  }
  const snapshotChain = EventChain.from({ id: json.id, events: json.events });
  if (snapshotChain.isPartial()) throw new Error('Consumption snapshot requires a complete chain');
  return { chain: snapshotChain, assets, expandedBytes };
}

interface AttachmentReference {
  cid: string;
  isSnapshot: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function signedAttachmentReferences(value: unknown): AttachmentReference[] {
  const message = record(value);
  if (message?.['@context'] === 'execute_msg.json') {
    const attachments = record(message.attach)?.attachments;
    if (Array.isArray(attachments)) {
      return attachments.map((attachment) => {
        const cid = record(attachment)?.cid;
        if (typeof cid !== 'string') throw new Error('Dossier attachment has no CID');
        return { cid, isSnapshot: false };
      });
    }
  }
  if (message?.['@context'] === 'ingest_msg.json' && message.type === 'consume') {
    const cid = record(message.source)?.cid;
    if (typeof cid === 'string') return [{ cid, isSnapshot: true }];
  }
  return [];
}

export async function collectOwnableAttachments(
  chain: EventChain,
  readAttachment: (cid: string) => Promise<Uint8Array | undefined>,
  limits: ConsumptionSnapshotLimits = {}
): Promise<Map<string, Uint8Array>> {
  const attachments = new Map<string, Uint8Array>();
  const activeSnapshots = new Set<string>();
  const visitedSnapshots = new Set<string>();
  let remainingBytes = limits.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES;

  async function collect(currentChain: EventChain, depth: number): Promise<void> {
    if (depth > MAX_SNAPSHOT_DEPTH) throw new Error('Consumption snapshot nesting limit exceeded');
    for (const event of currentChain.events) {
      for (const { cid, isSnapshot } of signedAttachmentReferences(event.parsedData)) {
        assertCidFormat(cid);
        let bytes = attachments.get(cid);
        for (const inline of isSnapshot ? [] : event.attachments) {
          if (inline.name !== cid) continue;
          await assertAttachmentCid(cid, inline.data);
          bytes ??= new Uint8Array(
            inline.data.buffer,
            inline.data.byteOffset,
            inline.data.byteLength
          );
        }
        bytes ??= await readAttachment(cid);
        if (!bytes) throw new Error(`Missing attachment ${cid}`);
        if (!attachments.has(cid)) {
          remainingBytes -= bytes.byteLength;
          if (remainingBytes < 0 || attachments.size >= MAX_ARCHIVE_ENTRIES) {
            throw new Error('Ownable attachment collection exceeds its size limit');
          }
          await assertAttachmentCid(cid, bytes);
          attachments.set(cid, bytes);
        }
        if (!isSnapshot || visitedSnapshots.has(cid)) continue;
        if (activeSnapshots.has(cid)) throw new Error(`Cyclic consumption snapshot ${cid}`);
        activeSnapshots.add(cid);
        const snapshot = await readConsumptionSnapshot(bytes, { maxExpandedBytes: remainingBytes });
        remainingBytes -= snapshot.expandedBytes;
        await collect(snapshot.chain, depth + 1);
        activeSnapshots.delete(cid);
        visitedSnapshots.add(cid);
      }
    }
  }

  await collect(chain, 0);
  return attachments;
}
