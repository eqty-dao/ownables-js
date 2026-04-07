import { Event, EventChain } from 'eqty-core';
import { decode, encode } from 'cbor-x';
import type { StateDump } from '@ownables/core';
import type {
  RNAttachmentBlobStore,
  RNCidCalculator,
  RNOwnableAttachmentRef,
  RNOwnablePersistenceBackend,
  RNOwnableRecord,
  RNOwnableSnapshotRecord,
  RNOwnableStateEntry,
  RNStoredEventRecord,
} from '../types/PlatformReactNative';

function toBytes(input: ArrayLike<number>): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return Uint8Array.from(input);
}

function compareSnapshots(a: RNOwnableSnapshotRecord, b: RNOwnableSnapshotRecord): number {
  return b.eventIndex - a.eventIndex;
}

export interface RNOwnablePersistenceOptions {
  backend: RNOwnablePersistenceBackend;
  attachmentStore: RNAttachmentBlobStore;
  cidCalculator: RNCidCalculator;
}

export interface SaveSnapshotOptions {
  keepLatest?: number;
}

export default class RNOwnablePersistence {
  constructor(private readonly options: RNOwnablePersistenceOptions) {}

  async saveOwnable(record: RNOwnableRecord): Promise<void> {
    await this.options.backend.upsertOwnable(record);
  }

  async appendEvent(ownableId: string, event: Event, eventIndex?: number): Promise<number> {
    const events = await this.options.backend.listEvents(ownableId);
    const index = eventIndex ?? events.length;

    if (events.some((stored) => stored.eventIndex === index)) {
      throw new Error(`Event index ${index} already exists for ownable ${ownableId}`);
    }

    const attachments = await this.persistAttachments(ownableId, index, event.attachments ?? []);

    const record: RNStoredEventRecord = {
      ownableId,
      eventIndex: index,
      eventHash: event.hash.hex,
      eventBin: toBytes(event.toBinary()),
      mediaType: event.mediaType,
      ...(event.previous?.hex ? { previousHash: event.previous.hex } : {}),
      ...(event.timestamp !== undefined ? { timestampMs: event.timestamp } : {}),
      ...(event.signerAddress ? { signerAddress: event.signerAddress } : {}),
    };

    await this.options.backend.putEvent(record);
    await this.options.backend.putEventAttachmentRefs(ownableId, index, attachments);

    return index;
  }

  private async persistAttachments(
    ownableId: string,
    eventIndex: number,
    attachments: Array<{ name: string; mediaType: string; data: ArrayLike<number> }>
  ): Promise<RNOwnableAttachmentRef[]> {
    const refs: RNOwnableAttachmentRef[] = [];

    for (let ordinal = 0; ordinal < attachments.length; ordinal++) {
      const attachment = attachments[ordinal];
      if (!attachment) continue;

      const bytes = toBytes(attachment.data);
      const cid = await this.options.cidCalculator(bytes);

      const blob = await this.options.backend.getAttachmentBlob(cid);
      if (!blob) {
        await this.options.attachmentStore.write(cid, bytes);
        await this.options.backend.upsertAttachmentBlob({
          cid,
          sizeBytes: bytes.byteLength,
          mediaType: attachment.mediaType,
          refCount: 1,
          createdAt: Date.now(),
        });
      } else {
        await this.options.backend.updateAttachmentBlobRefCount(cid, 1);
      }

      refs.push({
        ownableId,
        eventIndex,
        ordinal,
        attachmentName: attachment.name,
        mediaType: attachment.mediaType,
        cid,
      });
    }

    return refs;
  }

  async loadChain(ownableId: string): Promise<EventChain> {
    const ownable = await this.options.backend.getOwnable(ownableId);
    if (!ownable) {
      throw new Error(`Unknown ownable ${ownableId}`);
    }

    const chain = new EventChain(ownable.id);
    const events = (await this.options.backend.listEvents(ownableId)).sort(
      (a, b) => a.eventIndex - b.eventIndex
    );

    for (const stored of events) {
      const event = Event.from(stored.eventBin);
      const refs = (await this.options.backend.listEventAttachmentRefs(ownableId, stored.eventIndex)).sort(
        (a, b) => a.ordinal - b.ordinal
      );

      for (const ref of refs) {
        const bytes = await this.options.attachmentStore.read(ref.cid);
        if (!bytes) {
          throw new Error(
            `attachment_missing: ${ref.cid} for ${ownableId}#${stored.eventIndex}`
          );
        }

        event.addAttachment(ref.attachmentName, bytes, ref.mediaType);
      }

      chain.add(event);
    }

    return chain;
  }

  async saveStateDump(ownableId: string, stateDump: StateDump): Promise<void> {
    const entries: RNOwnableStateEntry[] = stateDump.map(([key, value]) => ({
      ownableId,
      keyBlob: toBytes(key),
      valueBlob: toBytes(value),
    }));

    await this.options.backend.replaceStateEntries(ownableId, entries);
  }

  async loadStateDump(ownableId: string): Promise<StateDump> {
    const entries = await this.options.backend.listStateEntries(ownableId);
    return entries.map((entry) => [entry.keyBlob, entry.valueBlob]);
  }

  async saveSnapshot(
    ownableId: string,
    eventIndex: number,
    blockHash: string,
    stateDump: StateDump,
    options: SaveSnapshotOptions = {}
  ): Promise<void> {
    const keepLatest = options.keepLatest ?? 3;

    const snapshot: RNOwnableSnapshotRecord = {
      ownableId,
      eventIndex,
      blockHash,
      stateBlob: encode(stateDump) as Uint8Array,
      createdAt: Date.now(),
    };

    await this.options.backend.putSnapshot(snapshot);

    const snapshots = await this.options.backend.listSnapshots(ownableId);
    const sorted = snapshots.sort(compareSnapshots);

    if (sorted.length > keepLatest) {
      const remove = sorted.slice(keepLatest).map((entry) => entry.eventIndex);
      await this.options.backend.deleteSnapshots(ownableId, remove);
    }
  }

  async getLatestSnapshot(ownableId: string): Promise<{ eventIndex: number; blockHash: string; stateDump: StateDump } | null> {
    const snapshots = await this.options.backend.listSnapshots(ownableId);
    if (snapshots.length === 0) return null;

    const latest = snapshots.sort(compareSnapshots)[0];
    if (!latest) return null;

    return {
      eventIndex: latest.eventIndex,
      blockHash: latest.blockHash,
      stateDump: decode(latest.stateBlob) as StateDump,
    };
  }

  async deleteOwnable(ownableId: string): Promise<void> {
    const refs = await this.options.backend.listAttachmentRefsForOwnable(ownableId);

    for (const ref of refs) {
      const blob = await this.options.backend.updateAttachmentBlobRefCount(ref.cid, -1);
      if (blob && blob.refCount <= 0) {
        await this.options.attachmentStore.delete(ref.cid);
        await this.options.backend.deleteAttachmentBlob(ref.cid);
      }
    }

    await this.options.backend.deleteOwnable(ownableId);
  }
}
