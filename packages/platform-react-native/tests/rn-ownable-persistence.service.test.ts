import { describe, expect, it } from 'vitest';
import { Event, EventChain } from 'eqty-core';

import RNOwnablePersistence from '../src/services/RNOwnablePersistence.service';
import type {
  RNAttachmentBlobRecord,
  RNAttachmentBlobStore,
  RNOwnableAttachmentRef,
  RNOwnablePersistenceBackend,
  RNOwnableRecord,
  RNOwnableSnapshotRecord,
  RNOwnableStateEntry,
  RNStoredEventRecord,
} from '../src/types/PlatformReactNative';

class InMemoryAttachmentStore implements RNAttachmentBlobStore {
  private readonly map = new Map<string, Uint8Array>();

  async has(cid: string): Promise<boolean> {
    return this.map.has(cid);
  }

  async read(cid: string): Promise<Uint8Array | undefined> {
    return this.map.get(cid);
  }

  async write(cid: string, bytes: Uint8Array): Promise<void> {
    this.map.set(cid, Uint8Array.from(bytes));
  }

  async delete(cid: string): Promise<void> {
    this.map.delete(cid);
  }
}

class InMemoryPersistenceBackend implements RNOwnablePersistenceBackend {
  readonly ownables = new Map<string, RNOwnableRecord>();
  readonly events = new Map<string, RNStoredEventRecord[]>();
  readonly stateEntries = new Map<string, RNOwnableStateEntry[]>();
  readonly snapshots = new Map<string, RNOwnableSnapshotRecord[]>();
  readonly attachmentBlobs = new Map<string, RNAttachmentBlobRecord>();
  readonly attachmentRefs = new Map<string, RNOwnableAttachmentRef[]>();

  async upsertOwnable(record: RNOwnableRecord): Promise<void> {
    this.ownables.set(record.id, record);
  }

  async getOwnable(id: string): Promise<RNOwnableRecord | undefined> {
    return this.ownables.get(id);
  }

  async putEvent(record: RNStoredEventRecord): Promise<void> {
    const list = this.events.get(record.ownableId) ?? [];
    list.push(record);
    this.events.set(record.ownableId, list);
  }

  async listEvents(ownableId: string): Promise<RNStoredEventRecord[]> {
    return [...(this.events.get(ownableId) ?? [])];
  }

  async replaceStateEntries(ownableId: string, entries: RNOwnableStateEntry[]): Promise<void> {
    this.stateEntries.set(ownableId, [...entries]);
  }

  async listStateEntries(ownableId: string): Promise<RNOwnableStateEntry[]> {
    return [...(this.stateEntries.get(ownableId) ?? [])];
  }

  async putSnapshot(snapshot: RNOwnableSnapshotRecord): Promise<void> {
    const list = this.snapshots.get(snapshot.ownableId) ?? [];
    const filtered = list.filter((item) => item.eventIndex !== snapshot.eventIndex);
    filtered.push(snapshot);
    this.snapshots.set(snapshot.ownableId, filtered);
  }

  async listSnapshots(ownableId: string): Promise<RNOwnableSnapshotRecord[]> {
    return [...(this.snapshots.get(ownableId) ?? [])];
  }

  async deleteSnapshots(ownableId: string, eventIndexes: number[]): Promise<void> {
    const existing = this.snapshots.get(ownableId) ?? [];
    const remove = new Set(eventIndexes);
    this.snapshots.set(
      ownableId,
      existing.filter((snapshot) => !remove.has(snapshot.eventIndex))
    );
  }

  async putEventAttachmentRefs(
    ownableId: string,
    eventIndex: number,
    refs: RNOwnableAttachmentRef[]
  ): Promise<void> {
    const key = `${ownableId}:${eventIndex}`;
    this.attachmentRefs.set(key, [...refs]);
  }

  async listEventAttachmentRefs(
    ownableId: string,
    eventIndex: number
  ): Promise<RNOwnableAttachmentRef[]> {
    return [...(this.attachmentRefs.get(`${ownableId}:${eventIndex}`) ?? [])];
  }

  async listAttachmentRefsForOwnable(ownableId: string): Promise<RNOwnableAttachmentRef[]> {
    const refs: RNOwnableAttachmentRef[] = [];

    for (const [key, value] of this.attachmentRefs.entries()) {
      if (key.startsWith(`${ownableId}:`)) {
        refs.push(...value);
      }
    }

    return refs;
  }

  async upsertAttachmentBlob(record: RNAttachmentBlobRecord): Promise<void> {
    this.attachmentBlobs.set(record.cid, record);
  }

  async getAttachmentBlob(cid: string): Promise<RNAttachmentBlobRecord | undefined> {
    return this.attachmentBlobs.get(cid);
  }

  async updateAttachmentBlobRefCount(
    cid: string,
    delta: number
  ): Promise<RNAttachmentBlobRecord | undefined> {
    const blob = this.attachmentBlobs.get(cid);
    if (!blob) return undefined;

    const updated = { ...blob, refCount: blob.refCount + delta };
    this.attachmentBlobs.set(cid, updated);

    return updated;
  }

  async deleteAttachmentBlob(cid: string): Promise<void> {
    this.attachmentBlobs.delete(cid);
  }

  async deleteOwnable(ownableId: string): Promise<void> {
    this.ownables.delete(ownableId);
    this.events.delete(ownableId);
    this.stateEntries.delete(ownableId);
    this.snapshots.delete(ownableId);

    for (const key of Array.from(this.attachmentRefs.keys())) {
      if (key.startsWith(`${ownableId}:`)) this.attachmentRefs.delete(key);
    }
  }
}

function createSignedEvent(chain: EventChain, data: unknown): Event {
  const event = new Event(data as any);
  event.addTo(chain);
  event.signerAddress = '0x1111111111111111111111111111111111111111';
  event.timestamp = Date.now();
  return event;
}

function createPersistence() {
  const backend = new InMemoryPersistenceBackend();
  const attachmentStore = new InMemoryAttachmentStore();

  const persistence = new RNOwnablePersistence({
    backend,
    attachmentStore,
    cidCalculator: async (bytes) =>
      `cid:${Array.from(bytes)
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`,
  });

  return { persistence, backend, attachmentStore };
}

describe('RNOwnablePersistence', () => {
  it('stores and loads chain events with attachment hydration', async () => {
    const { persistence } = createPersistence();
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);

    await persistence.saveOwnable({
      id: chain.id,
      packageCid: 'cid-pkg',
      stateHex: chain.state.hex,
      latestHash: chain.latestHash.hex,
      createdAt: Date.now(),
      uniqueMessageHash: 'msg-1',
      isConsumed: false,
    });

    const event = createSignedEvent(chain, { '@context': 'execute_msg.json', ping: true });
    event.addAttachment('consumable-chain', new Uint8Array([1, 2, 3]), 'application/octet-stream');

    await persistence.appendEvent(chain.id, event);

    const loaded = await persistence.loadChain(chain.id);
    expect(loaded.events).toHaveLength(1);
    expect(loaded.events[0]?.attachments).toHaveLength(1);
    expect(loaded.events[0]?.attachments[0]?.name).toBe('consumable-chain');
  });

  it('throws deterministic error when attachment blob is missing', async () => {
    const { persistence, attachmentStore } = createPersistence();
    const chain = EventChain.create('0x1111111111111111111111111111111111111111', 84532);

    await persistence.saveOwnable({
      id: chain.id,
      packageCid: 'cid-pkg',
      stateHex: chain.state.hex,
      latestHash: chain.latestHash.hex,
      createdAt: Date.now(),
      uniqueMessageHash: 'msg-1',
      isConsumed: false,
    });

    const event = createSignedEvent(chain, { '@context': 'execute_msg.json', ping: true });
    event.addAttachment('consumable-chain', new Uint8Array([9]), 'application/octet-stream');
    await persistence.appendEvent(chain.id, event);

    await attachmentStore.delete('cid:09');

    await expect(persistence.loadChain(chain.id)).rejects.toThrow('attachment_missing');
  });

  it('stores state dump and manages snapshots with pruning', async () => {
    const { persistence } = createPersistence();
    const ownableId = 'ownable-1';

    await persistence.saveStateDump(ownableId, [
      [new Uint8Array([1]), new Uint8Array([10])],
      [new Uint8Array([2]), new Uint8Array([20])],
    ]);

    const state = await persistence.loadStateDump(ownableId);
    expect(state).toHaveLength(2);

    await persistence.saveSnapshot(ownableId, 1, '0x1', state);
    await persistence.saveSnapshot(ownableId, 2, '0x2', state);
    await persistence.saveSnapshot(ownableId, 3, '0x3', state);
    await persistence.saveSnapshot(ownableId, 4, '0x4', state);

    const latest = await persistence.getLatestSnapshot(ownableId);
    expect(latest?.eventIndex).toBe(4);
  });

  it('reference-counts shared attachments across ownables and gc on delete', async () => {
    const { persistence, backend, attachmentStore } = createPersistence();

    const chainA = EventChain.create('0x1111111111111111111111111111111111111111', 84532);
    const chainB = EventChain.create('0x2222222222222222222222222222222222222222', 84532);

    for (const chain of [chainA, chainB]) {
      await persistence.saveOwnable({
        id: chain.id,
        packageCid: 'cid-pkg',
        stateHex: chain.state.hex,
        latestHash: chain.latestHash.hex,
        createdAt: Date.now(),
        uniqueMessageHash: chain.id,
        isConsumed: false,
      });

      const event = createSignedEvent(chain, { '@context': 'execute_msg.json', ping: true });
      event.addAttachment('consumable-chain', new Uint8Array([7, 7]), 'application/octet-stream');
      await persistence.appendEvent(chain.id, event);
    }

    expect(backend.attachmentBlobs.get('cid:0707')?.refCount).toBe(2);

    await persistence.deleteOwnable(chainA.id);
    expect(backend.attachmentBlobs.get('cid:0707')?.refCount).toBe(1);
    expect(await attachmentStore.has('cid:0707')).toBe(true);

    await persistence.deleteOwnable(chainB.id);
    expect(backend.attachmentBlobs.get('cid:0707')).toBeUndefined();
    expect(await attachmentStore.has('cid:0707')).toBe(false);
  });
});
