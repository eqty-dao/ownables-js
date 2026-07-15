import { EventChain, Event, Binary } from "eqty-core";
import { encode } from "cbor-x";
import type TypedDict from "../types/TypedDict.js";
import type {
  AnchorProvider,
  PackageAssetIO,
  RuntimeRPCProvider,
  RuntimeSourceProvider,
  StateStore,
  LogProgress,
} from "../interfaces/core.js";
import JSZip from "jszip";
import type { TypedPackage } from "../types/TypedPackage.js";
import type { TypedOwnableInfo } from "../types/TypedOwnableInfo.js";
import type {
  CosmWasmMessageInfo,
  CosmWasmEvent,
  EmittedPublicEventReceipt,
  EventAttachmentInput,
  OwnableEvent,
  PublicEvent,
  OwnableRPC,
  RuntimePublicEvent,
  StateDump,
  StateSnapshot,
} from "../types/OwnableRuntime.js";
import type {
  IndexedPublicEvent,
  IndexedPublicEventTransportOrigin,
  IndexedPublicReplaySelectionOptions,
  ReconciledPublicEvent,
  ReplayAttemptResult,
} from "../types/Replay.js";
import EventChainService from "./EventChain.service.js";
import { withProgress } from "../progress.js";
import type { LoggerLike } from "../logger.js";
import { PublicEventReplayService } from "./ReplayAuthority.service.js";

export interface OwnableServiceDependencies {
  stateStore: StateStore;
  eventChains: EventChainService;
  anchorProvider: AnchorProvider;
  packages: PackageAssetIO;
  runtimeSource: RuntimeSourceProvider;
  runtimeRpc: RuntimeRPCProvider;
  replay: PublicEventReplayService;
  logger?: LoggerLike;
}

export default class OwnableService {
  private readonly SNAPSHOT_INTERVAL = 50;
  private readonly PUBLIC_EVENT_REPLAY_STORE_SUFFIX = ".public-event-replays";

  private readonly stateStore: StateStore;
  private readonly eventChains: EventChainService;
  private readonly eqty: AnchorProvider;
  private readonly packages: PackageAssetIO;
  private readonly runtimeSource: RuntimeSourceProvider;
  private readonly runtimeRpc: RuntimeRPCProvider;
  private readonly replay: PublicEventReplayService;
  private readonly logger: LoggerLike;

  constructor(deps: OwnableServiceDependencies) {
    this.stateStore = deps.stateStore;
    this.eventChains = deps.eventChains;
    this.eqty = deps.anchorProvider;
    this.packages = deps.packages;
    this.runtimeSource = deps.runtimeSource;
    this.runtimeRpc = deps.runtimeRpc;
    this.replay = deps.replay;
    this.logger = deps.logger ?? console;
  }

  private readonly _rpc = new Map<string, OwnableRPC>();

  get anchoring(): boolean {
    return this.eventChains.anchoring;
  }

  async loadAll(): Promise<
    Array<{
      chain: EventChain;
      package: string;
      isConsumed?: boolean;
      created: Date;
      keywords: string[];
      uniqueMessageHash?: string;
    }>
  > {
    return this.eventChains.loadAll();
  }

  isReady(id: string): boolean {
    return this._rpc.has(id);
  }

  rpc(id: string): OwnableRPC {
    const rpc = this._rpc.get(id);
    if (!rpc) throw new Error(`No RPC for ownable ${id}`);
    return rpc;
  }

  clearRpc(id: string) {
    const rpc = this._rpc.get(id);
    if (!rpc) return;
    rpc.terminate();
    this._rpc.delete(id);
  }

  setWidgetWindow(id: string, win: unknown | null): void {
    const rpc = this._rpc.get(id);
    if (rpc) rpc.setWidgetWindow(win);
  }

  async initWorker(id: string, cid: string): Promise<void> {
    if (this._rpc.has(id)) return;

    const js = this.runtimeSource.getWorkerSource();
    const wasm = (await this.packages.getAsset(
      cid,
      "ownable_bg.wasm",
      (fr, file) => (fr as FileReader).readAsArrayBuffer(file as Blob | File)
    )) as ArrayBuffer;

    const rpc = this.runtimeRpc.create(id);
    await rpc.initialize(js, new Uint8Array(wasm));
    this._rpc.set(id, rpc);
  }

  async create(
    pkg: TypedPackage,
    onProgress?: LogProgress
  ): Promise<{ chain: EventChain; txHash?: string }> {
    const address = this.eqty.address;
    const networkId = this.eqty.chainId;
    const chain = EventChain.create(address, networkId);
    const anchors: Array<any> = [];

    if (pkg.isDynamic || this.anchoring) {
      const msg: any = {
        "@context": "instantiate_msg.json",
        ownable_id: chain.id,
        package: pkg.cid,
        network_id: networkId,
        keywords: pkg.keywords ?? [],
        ...(pkg.title ? { name: pkg.title } : {}),
        ...(pkg.description ? { description: pkg.description } : {}),
      };

      await withProgress(onProgress)("signEvent", () =>
        this.eqty.sign(new Event(msg).addTo(chain))
      );
    }

    if (this.anchoring) {
      const hash = chain.latestHash.hex;
      anchors.push(...chain.startingWith(Binary.fromHex(hash)).anchorMap);
    }

    if (anchors.length > 0) {
      // Queue anchors and submit as single tx
      await this.eqty.anchor(...anchors);
      const txHash = await withProgress(onProgress)("anchorEvent", () =>
        this.eqty.submitAnchors()
      );
      return txHash ? { chain, txHash } : { chain };
    }

    return { chain };
  }

  async init(
    chain: any,
    cid: string,
    uniqueMessageHash?: string
  ): Promise<void> {
    if (!this._rpc.has(chain.id)) {
      await this.initWorker(chain.id, cid);
    }

    const stateDump = await this.apply(chain, []);
    await this.initStore(chain, cid, uniqueMessageHash, stateDump);
  }

  private async createSnapshot(
    chain: EventChain,
    stateDump: StateDump,
    eventIndex: number
  ): Promise<void> {
    const chainId = chain.id;
    const storeId = `ownable:${chainId}`;
    const snapshotStoreId = `${storeId}.snapshots`;

    try {
      const snapshot: StateSnapshot = {
        eventIndex,
        blockHash: chain.latestHash.hex,
        stateDump,
        timestamp: new Date(),
      };

      if (!(await this.stateStore.hasStore(snapshotStoreId))) {
        await this.stateStore.createStore(snapshotStoreId);
      }

      await this.stateStore.set(snapshotStoreId, `snapshot_${eventIndex}`, snapshot);

      // Cleanup old snapshots (keep only last 3)
      const keys = await this.stateStore.keys(snapshotStoreId);
      if (keys.length > 3) {
        const sortedKeys = keys
          .map((key) => parseInt(key.replace("snapshot_", "")))
          .sort((a, b) => b - a);

        // Delete oldest snapshots, keep the 3 most recent
        const keysToDelete = sortedKeys
          .slice(3)
          .map((index) => `snapshot_${index}`);

        for (const key of keysToDelete) {
          await this.stateStore.delete(snapshotStoreId, key);
        }
      }
    } catch (error) {
      this.logger.error("Error creating snapshot:", error);
    }
  }

  private async getLatestSnapshot(
    chainId: string
  ): Promise<StateSnapshot | null> {
    const storeId = `ownable:${chainId}`;
    const snapshotStoreId = `${storeId}.snapshots`;
    const exist = await this.stateStore.hasStore(snapshotStoreId);

    if (!exist) {
      return null;
    }

    const snapshots = await this.stateStore.keys(snapshotStoreId);
    if (snapshots.length === 0) return null;

    const latestKey = snapshots
      .map((key) => parseInt(key.replace("snapshot_", "")))
      .sort((a, b) => b - a)[0];

    return await this.stateStore.get(snapshotStoreId, `snapshot_${latestKey}`);
  }

  async listSnapshots(chainId: string): Promise<StateSnapshot[]> {
    const storeId = `ownable:${chainId}`;
    const snapshotStoreId = `${storeId}.snapshots`;

    if (!(await this.stateStore.hasStore(snapshotStoreId))) {
      return [];
    }

    const snapshots = await this.stateStore.keys(snapshotStoreId);
    const sortedKeys = snapshots
      .map((key) => parseInt(key.replace("snapshot_", "")))
      .sort((a, b) => a - b);

    return Promise.all(
      sortedKeys.map((index) =>
        this.stateStore.get(snapshotStoreId, `snapshot_${index}`)
      )
    );
  }

  async deleteSnapshots(chainId: string): Promise<void> {
    const storeId = `ownable:${chainId}`;
    const snapshotStoreId = `${storeId}.snapshots`;

    if (await this.stateStore.hasStore(snapshotStoreId)) {
      await this.stateStore.deleteStore(snapshotStoreId);
    }
  }

  private publicEventReplayStoreId(chainId: string): string {
    return `ownable:${chainId}${this.PUBLIC_EVENT_REPLAY_STORE_SUFFIX}`;
  }

  private replayRecord(
    event: IndexedPublicEvent,
    status: ReconciledPublicEvent["status"],
    sources: IndexedPublicEventTransportOrigin[]
  ): ReconciledPublicEvent {
    return {
      replayKey: this.replay.key(event),
      event,
      status,
      sources: [...new Set(sources)],
    };
  }

  private mergeReplayRecordSources(
    current: IndexedPublicEventTransportOrigin[],
    next: IndexedPublicEventTransportOrigin
  ): IndexedPublicEventTransportOrigin[] {
    return current.includes(next) ? current : [...current, next];
  }

  private async ensureReplayStore(chainId: string): Promise<string> {
    const replayStoreId = this.publicEventReplayStoreId(chainId);
    if (!(await this.stateStore.hasStore(replayStoreId))) {
      await this.stateStore.createStore(replayStoreId);
    }
    return replayStoreId;
  }

  private async listReplayRecords(chainId: string): Promise<ReconciledPublicEvent[]> {
    const replayStoreId = this.publicEventReplayStoreId(chainId);
    if (!(await this.stateStore.hasStore(replayStoreId))) {
      return [];
    }

    const records = (await this.stateStore.getAll(replayStoreId)) as ReconciledPublicEvent[];
    return [...records].sort((left, right) => {
      if (left.event.blockNumber !== right.event.blockNumber) {
        return left.event.blockNumber - right.event.blockNumber;
      }
      if (left.event.transactionIndex !== right.event.transactionIndex) {
        return left.event.transactionIndex - right.event.transactionIndex;
      }
      return left.event.logIndex - right.event.logIndex;
    });
  }

  async listTrackedPublicEvents(chainId: string): Promise<ReconciledPublicEvent[]> {
    return this.listReplayRecords(chainId);
  }

  private emptyReplayAttemptResult(stateDump: StateDump): ReplayAttemptResult {
    return {
      complete: true,
      stateDump,
      appliedEvents: [],
      appliedReplayKeys: [],
      duplicateReplayKeys: [],
      appliedPublicEvents: [],
      duplicatePublicEvents: [],
      ignoredPublicEvents: [],
      pendingPublicEvents: [],
      confirmedPendingPublicEvents: [],
    };
  }

  private publicEventSubjectId(chain: EventChain): string {
    return Binary.fromHex(chain.id).hash().hex;
  }

  private provisionalPublicEventReplayKey(
    chain: EventChain,
    eventType: string,
    data: Uint8Array
  ): string {
    return `pending:${this.publicEventSubjectId(chain)}:${eventType}:${new Binary(data).hash().hex}`;
  }

  private provisionalPublicEventRecord(
    chain: EventChain,
    eventType: string,
    data: Uint8Array
  ): ReconciledPublicEvent {
    const replayKey = this.provisionalPublicEventReplayKey(chain, eventType, data);
    const payloadHex = new Binary(data).hex;
    return {
      replayKey,
      event: {
        source: this.eqty.address,
        eventType,
        data: payloadHex,
        blockNumber: 0,
        transactionHash: payloadHex,
        transactionIndex: 0,
        logIndex: 0,
      },
      status: "pending",
      sources: ["local"],
    };
  }

  private toRegisterRuntimeEvent(
    event: Omit<PublicEvent, "data"> & { data: string | Uint8Array | Binary; subjectId?: string }
  ): PublicEvent {
    const { subjectId: _subjectId, timestamp: _timestamp, ...publicEvent } = event as typeof event & {
      timestamp?: number;
    };
    return {
      ...publicEvent,
      data:
        typeof publicEvent.data === "string"
          ? publicEvent.data
          : new Binary(event.data).hex,
    };
  }

  private publicEventSubjectMatches(
    chain: EventChain,
    event: Pick<EmittedPublicEventReceipt, "subjectId">
  ): boolean {
    return event.subjectId.toLowerCase() === this.publicEventSubjectId(chain).toLowerCase();
  }

  private toRegisterRpcPayload(event: PublicEvent): RuntimePublicEvent {
    return {
      ...event,
      data: Binary.fromHex(event.data),
      transactionHash: Binary.fromHex(event.transactionHash),
    };
  }

  private async applyEvent(
    rpc: OwnableRPC,
    event: Event,
    stateDump: StateDump,
    chain: EventChain,
    eventIndex: number
  ): Promise<{ result?: TypedDict; state: StateDump }> {
    const info = {
      sender: event.signerAddress || this.eqty.address,
      funds: [],
    } as CosmWasmMessageInfo;
    const { "@context": context, ...msg } = event.parsedData;

    let result;
    switch (context) {
      case "instantiate_msg.json":
        result = await rpc.instantiate(msg, info);
        break;
      case "execute_msg.json":
        result = await rpc.execute(msg, info, stateDump);
        break;
      case "register_msg.json":
        result = await rpc.register(this.toRegisterRpcPayload(msg as PublicEvent), info, stateDump);
        break;
      case "ingest_msg.json":
        result = await rpc.ingest(msg as OwnableEvent, info, stateDump);
        break;
      default:
        throw new Error(`Unknown event type`);
    }

    if ((eventIndex + 1) % this.SNAPSHOT_INTERVAL === 0) {
      await this.createSnapshot(chain, result.state, eventIndex);
    }

    return result;
  }

  async apply(
    partialChain: EventChain,
    stateDump: StateDump
  ): Promise<StateDump> {
    const rpc = this.rpc(partialChain.id);
    const snapshot = await this.getLatestSnapshot(partialChain.id);
    let startIndex = 0;

    if (snapshot) {
      const snapshotEventIndex = partialChain.events.findIndex(
        (e: any) => e.hash?.hex === snapshot.blockHash
      );
      if (snapshotEventIndex !== -1) {
        stateDump = snapshot.stateDump;
        startIndex = snapshotEventIndex + 1;
      }
    }

    const BATCH_SIZE = 10;
    const totalEvents = partialChain.events.length;

    for (
      let batchStart = startIndex;
      batchStart < totalEvents;
      batchStart += BATCH_SIZE
    ) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalEvents);
      const batch = partialChain.events.slice(batchStart, batchEnd);

      for (let i = 0; i < batch.length; i++) {
        const globalIndex = batchStart + i;
        const event = batch[i];
        if (!event) continue;

        try {
          const result = await this.applyEvent(
            rpc,
            event,
            stateDump,
            partialChain,
            globalIndex
          );
          stateDump = result.state;
        } catch (error) {
          this.logger.error(`Error applying event at index ${globalIndex}:`, error);

          if (globalIndex > startIndex) {
            await this.createSnapshot(partialChain, stateDump, globalIndex - 1);
          }
          throw error;
        }
      }

      if (batchEnd < totalEvents) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return stateDump;
  }

  async replayIndexedPublicEvents(
    chainId: string,
    stateDump: StateDump,
    indexedPublicEvents: IndexedPublicEvent[],
    options?: IndexedPublicReplaySelectionOptions
  ): Promise<ReplayAttemptResult> {
    return this.attemptReplayIndexedPublicEvents(chainId, stateDump, indexedPublicEvents, options);
  }

  async attemptReplayIndexedPublicEvents(
    chainId: string,
    stateDump: StateDump,
    indexedPublicEvents: IndexedPublicEvent[],
    options?: IndexedPublicReplaySelectionOptions
  ): Promise<ReplayAttemptResult> {
    const info: CosmWasmMessageInfo = {
      sender: this.eqty.address,
      funds: [],
    };
    const deduped = this.replay.dedupe(indexedPublicEvents);
    const selected = options
      ? this.replay.selectReplayable(indexedPublicEvents, options)
      : { events: deduped.events, ignoredPublicEvents: [] };
    const events = selected.events;
    const duplicateReplayKeys = deduped.duplicateReplayKeys;
    const appliedEvents: IndexedPublicEvent[] = [];
    const appliedReplayKeys: string[] = [];
    const appliedPublicEvents = [];
    const duplicatePublicEvents = deduped.duplicateEvents.map((event) => ({
      replayKey: this.replay.key(event),
      event,
    }));
    const ignoredPublicEvents = [...selected.ignoredPublicEvents];
    let nextState = stateDump;

    for (const indexedEvent of events) {
      const runtimeEvent = this.toRegisterRuntimeEvent(indexedEvent);
      const replayKey = this.replay.key(indexedEvent);
      try {
        const { state } = await this.rpc(chainId).register(
          this.toRegisterRpcPayload(runtimeEvent),
          info,
          nextState
        );
        nextState = state;
        appliedEvents.push(indexedEvent);
        appliedReplayKeys.push(replayKey);
        appliedPublicEvents.push({
          replayKey,
          event: indexedEvent,
        });
      } catch (cause) {
        ignoredPublicEvents.push({
          replayKey,
          event: indexedEvent,
          reason: "register_failed",
          cause,
        });
      }
    }

    return {
      complete: ignoredPublicEvents.length === 0,
      stateDump: nextState,
      appliedEvents,
      appliedReplayKeys,
      duplicateReplayKeys,
      appliedPublicEvents,
      duplicatePublicEvents,
      ignoredPublicEvents,
      pendingPublicEvents: [],
      confirmedPendingPublicEvents: [],
    };
  }

  async applyIndexedPublicEventSnapshot(
    chain: EventChain,
    indexedPublicEvents: IndexedPublicEvent[],
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    return this.reconcileIndexedPublicEvents(chain, indexedPublicEvents, "snapshot", onProgress);
  }

  async applyIndexedPublicEventStream(
    chain: EventChain,
    indexedPublicEvents: IndexedPublicEvent[],
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    return this.reconcileIndexedPublicEvents(chain, indexedPublicEvents, "stream", onProgress);
  }

  private async reconcileIndexedPublicEvents(
    chain: EventChain,
    indexedPublicEvents: IndexedPublicEvent[],
    source: IndexedPublicEventTransportOrigin,
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    const stateDump = await this.eventChains.getStateDump(chain.id, chain.state.hex);
    if (!stateDump) throw Error("State mismatch for register public event");

    const replayStoreId = await this.ensureReplayStore(chain.id);
    const base = this.emptyReplayAttemptResult(stateDump);
    const deduped = this.replay.dedupe(indexedPublicEvents);
    const info: CosmWasmMessageInfo = {
      sender: this.eqty.address,
      funds: [],
    };

    base.duplicateReplayKeys.push(...deduped.duplicateReplayKeys);
    base.duplicatePublicEvents.push(
      ...deduped.duplicateEvents.map((event) => this.replayRecord(event, "confirmed", [source]))
    );

    let nextState = stateDump;

    for (const indexedEvent of deduped.events) {
      const replayKey = this.replay.key(indexedEvent);
      const existing = (await this.stateStore.get(replayStoreId, replayKey).catch(() => undefined)) as
        | ReconciledPublicEvent
        | undefined;

      if (existing?.status === "confirmed") {
        const updated = this.replayRecord(
          existing.event,
          "confirmed",
          this.mergeReplayRecordSources(existing.sources, source)
        );
        await this.stateStore.set(replayStoreId, replayKey, updated);
        base.duplicateReplayKeys.push(replayKey);
        base.duplicatePublicEvents.push(updated);
        continue;
      }

      const runtimeEvent = this.toRegisterRuntimeEvent(indexedEvent);
      try {
        const { state } = await this.rpc(chain.id).register(
          this.toRegisterRpcPayload(runtimeEvent),
          info,
          nextState
        );
        nextState = state;

        await withProgress(onProgress)("signPublicEvent", () =>
          this.eqty.sign(
            new Event({
              "@context": "register_msg.json",
              ...runtimeEvent,
            }).addTo(chain)
          )
        );

        await this.store(chain, nextState);

        const confirmedRecord = this.replayRecord(
          indexedEvent,
          "confirmed",
          existing?.status === "pending"
            ? this.mergeReplayRecordSources(existing.sources, source)
            : [source]
        );
        await this.stateStore.set(replayStoreId, replayKey, confirmedRecord);

        base.appliedEvents.push(indexedEvent);
        base.appliedReplayKeys.push(replayKey);
        base.appliedPublicEvents.push({ replayKey, event: indexedEvent });
        if (existing?.status === "pending") {
          base.confirmedPendingPublicEvents.push(confirmedRecord);
        }
      } catch (cause) {
        base.ignoredPublicEvents.push({
          replayKey,
          event: indexedEvent,
          reason: "register_failed",
          cause,
        });
      }
    }

    return {
      ...base,
      complete: base.ignoredPublicEvents.length === 0,
      stateDump: nextState,
    };
  }

  async execute(
    chain: EventChain,
    msg: TypedDict,
    stateDump: StateDump,
    onProgress?: LogProgress,
    attachments: EventAttachmentInput[] = []
  ): Promise<StateDump> {
    const info = { sender: this.eqty.address, funds: [] } as CosmWasmMessageInfo;
    const { state: newStateDump } = await this.rpc(chain.id).execute(
      msg,
      info,
      stateDump
    );

    delete msg["@context"]; // Shouldn't be set

    const event = new Event({ "@context": "execute_msg.json", ...msg }).addTo(chain);
    for (const attachment of attachments) {
      event.addAttachment(
        attachment.name,
        new Uint8Array(await attachment.file.arrayBuffer()),
        attachment.file.type || "application/octet-stream"
      );
    }

    await withProgress(onProgress)("signEvent", () => this.eqty.sign(event));

    // Store without submitting anchors yet; submission is controlled by caller
    await this.store(chain, newStateDump);

    return newStateDump;
  }

  async registerPublicEvent(
    chain: EventChain,
    event: Omit<PublicEvent, "data"> & { data: string | Uint8Array | Binary; subjectId?: string },
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    const publicEvent = this.toRegisterRuntimeEvent(event);
    return this.applyIndexedPublicEventStream(chain, [publicEvent], onProgress);
  }

  async emitPublicEvent(
    chain: EventChain,
    eventType: string,
    payload: TypedDict,
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    const stateDump = await this.eventChains.getStateDump(chain.id, chain.state.hex);
    if (!stateDump) throw Error("State mismatch for emit public event");

    const encodedPayload = await withProgress(onProgress)("encodePublicEvent", () =>
      this.rpc(chain.id).encodePublicEvent(eventType, encode(payload) as Uint8Array)
    );
    const subjectId = this.publicEventSubjectId(chain);
    const replayStoreId = await this.ensureReplayStore(chain.id);
    const provisionalPendingRecord = this.provisionalPublicEventRecord(
      chain,
      eventType,
      encodedPayload
    );
    await this.stateStore.set(
      replayStoreId,
      provisionalPendingRecord.replayKey,
      provisionalPendingRecord
    );

    let publicEvent: EmittedPublicEventReceipt;
    try {
      publicEvent = await withProgress(onProgress)("emitPublicEvent", () =>
        this.eqty.emitPublicEvent(subjectId, eventType, encodedPayload)
      );
    } catch (cause) {
      await this.stateStore.delete(replayStoreId, provisionalPendingRecord.replayKey);
      throw cause;
    }
    if (!this.publicEventSubjectMatches(chain, publicEvent)) {
      await this.stateStore.delete(replayStoreId, provisionalPendingRecord.replayKey);
      const result = this.emptyReplayAttemptResult(stateDump);
      result.complete = false;
      result.ignoredPublicEvents.push({
        replayKey: this.replay.key(this.toRegisterRuntimeEvent(publicEvent)),
        event: this.toRegisterRuntimeEvent(publicEvent),
        reason: "invalid_subject_id",
        cause: {
          expectedSubjectId: subjectId,
          receivedSubjectId: publicEvent.subjectId,
        },
      });
      return result;
    }

    const runtimeEvent = this.toRegisterRuntimeEvent(publicEvent);
    const pendingRecord = this.replayRecord(runtimeEvent, "pending", ["local"]);
    await this.stateStore.delete(replayStoreId, provisionalPendingRecord.replayKey);
    await this.stateStore.set(replayStoreId, pendingRecord.replayKey, pendingRecord);

    const result = this.emptyReplayAttemptResult(stateDump);
    result.pendingPublicEvents.push(pendingRecord);
    return result;
  }

  async submitAnchors(onProgress?: LogProgress): Promise<string | undefined> {
    if (!this.anchoring) return undefined;
    return await withProgress(onProgress)("anchor", () =>
      this.eqty.submitAnchors()
    );
  }

  async canConsume(
    consumer: { chain: EventChain; package: string },
    info: TypedOwnableInfo
  ): Promise<boolean> {
    if (!this.packages.info(consumer.package).isConsumer) return false;

    try {
      const state = await this.eventChains.getStateDump(
        consumer.chain.id,
        consumer.chain.state.hex
      );
      if (!state) return false;

      const result = await this.rpc(consumer.chain.id).query(
        {
          is_consumer_of: {
            consumable_type: info.ownable_type,
            issuer: info.issuer,
          },
        },
        state
      );

      return result === true;
    } catch (error) {
      this.logger.warn("Error checking canConsume:", error);
      return false;
    }
  }

  async consume(
    consumer: EventChain,
    consumable: EventChain,
    onProgress?: LogProgress
  ): Promise<void> {
    const info: CosmWasmMessageInfo = {
      sender: this.eqty.address,
      funds: [],
    };
    const consumeMessage = { consume: {} };
    const consumerState = await this.eventChains.getStateDump(
      consumer.id,
      consumer.state.hex
    );
    const consumableState = await this.eventChains.getStateDump(
      consumable.id,
      consumable.state.hex
    );
    if (!consumerState || !consumableState)
      throw Error("State mismatch for consume");

    const { events, state: consumableStateDump } = await this.rpc(
      consumable.id
    ).execute(consumeMessage, info, consumableState);

    const consumeEvent:
      | { contract?: string; type: string; attributes: TypedDict<string> }
      | undefined = events.find((event) => event.type === "consume");
    if (!consumeEvent) throw Error("No consume event emitted");
    const consumableInfo = (await this.rpc(consumable.id).query(
      { get_info: {} },
      consumableStateDump
    )) as TypedOwnableInfo;

    const ingestEvent: OwnableEvent = {
      source: {
        id: consumable.id,
        owner: consumableInfo.owner,
        issuer: consumableInfo.issuer,
      },
      attributes: consumeEvent.attributes,
      eventType: consumeEvent.type,
    };

    const { state: consumerStateDump } = await this.rpc(
      consumer.id
    ).ingest(ingestEvent, info, consumerState);

    await withProgress(onProgress)("signConsumableEvent", () =>
      this.eqty.sign(
        new Event({ "@context": "execute_msg.json", ...consumeMessage }).addTo(
          consumable
        )
      )
    );

    await withProgress(onProgress)("signConsumerEvent", () =>
      this.eqty.sign(
        new Event({
          "@context": "ingest_msg.json",
          ...ingestEvent,
        }).addTo(consumer)
      )
    );

    // Store both chains; emit anchor progress only once to represent anchoring both
    // Queue anchors for both chains without submitting yet
    await this.store(consumable, consumableStateDump);
    await this.stateStore.set(`ownable:${consumable.id}`, "isConsumed", true);
    await this.store(consumer, consumerStateDump);

    // Submit a single anchor tx for both
    await this.submitAnchors(onProgress);
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        this.logger.warn(`Attempt ${attempt} failed:`, error);

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }

    throw new Error(
      `Operation failed after ${maxRetries} attempts. Last error: `
    );
  }

  async initStore(
    chain: EventChain,
    pkg: string,
    uniqueMessageHash?: string,
    stateDump?: StateDump
  ): Promise<void> {
    const storeId = `ownable:${chain.id}`;
    const stateStoreId = `${storeId}.state`;

    const chainData = {
      chain: chain.toJSON(),
      state: chain.state.hex,
      package: pkg,
      isConsumed: false,
      created: new Date(),
      latestHash: chain.latestHash.hex,
      keywords: this.packages.info(pkg).keywords,
      uniqueMessageHash: this.packages.info(pkg, uniqueMessageHash)
        .uniqueMessageHash,
    };

    const stores = [storeId];
    if (stateDump) stores.push(stateStoreId);

    await this.retryOperation(async () => {
      const hasStore = await this.stateStore.hasStore(storeId);
      if (hasStore) {
        return;
      }

      await this.stateStore.createStore(...stores);

      const data: TypedDict = {
        [storeId]: chainData,
      };

      if (stateDump) {
        data[stateStoreId] = new Map(stateDump);
      }

      try {
        await this.stateStore.setAll(data);
      } catch (error) {
        // If setAll fails, attempt to clean up
        this.logger.error("Failed to set data, cleaning up stores...");
        await Promise.all(
          stores.map((store) => this.stateStore.deleteStore(store).catch(() => {}))
        );
        throw error;
      }

      const verifyData = await Promise.all([
        this.stateStore.get(storeId, "state"),
        stateDump ? this.stateStore.getAll(stateStoreId) : Promise.resolve(null),
      ]);

      if (
        verifyData[0] !== chainData.state ||
        (stateDump && !verifyData[1]?.length)
      ) {
        throw new Error("Data verification failed after write");
      }
    });
  }

  async store(chain: EventChain, stateDump: StateDump): Promise<void> {
    const anchors: Array<any> = [];
    const storeId = `ownable:${chain.id}`;
    const stateStoreId = `${storeId}.state`;

    await this.retryOperation(async () => {
      const storedState = await this.stateStore.get(storeId, "state");
      if (storedState === chain.state) return;

      const data = {
        [storeId]: {
          chain: chain.toJSON(),
          state: chain.state.hex,
          latestHash: chain.latestHash.hex,
        },
        [stateStoreId]: new Map(stateDump),
      };

      if (this.anchoring) {
        const previousHash = await this.stateStore.get(
          `ownable:${chain.id}`,
          "latestHash"
        );
        anchors.push(
          ...chain.startingAfter(Binary.fromHex(previousHash)).anchorMap
        );
      }

      if (anchors.length > 0) {
        // Queue anchors only; submission handled separately to allow batching
        await this.eqty.anchor(...anchors);
      }

      await this.stateStore.setAll(data);

      const eventCount = chain.events.length;
      if (eventCount % this.SNAPSHOT_INTERVAL === 0) {
        await this.createSnapshot(chain, stateDump, eventCount - 1);
      }

      // Verify write
      const verifyState = await this.stateStore.get(storeId, "state");
      if (verifyState !== chain.state.hex) {
        throw new Error("State verification failed after write");
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.eventChains.delete(id);
  }

  async deleteAll(): Promise<void> {
    await this.eventChains.deleteAll();
  }

  async zip(chain: EventChain): Promise<JSZip> {
    const firstEvent = chain.events[0];
    if (!firstEvent) throw new Error("Cannot zip an empty ownable chain");
    const packageCid: string = firstEvent.parsedData.package;

    const zip = await this.packages.zip(packageCid);
    zip.file("chain.json", JSON.stringify(chain.toJSON()));

    return zip;
  }
}
