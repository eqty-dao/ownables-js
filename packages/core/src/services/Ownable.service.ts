import { EventChain, Event, Binary } from 'eqty-core';
import { encode } from 'cbor-x';
import type TypedDict from '../types/TypedDict.js';
import type {
  AnchorProvider,
  PackageAssetIO,
  RuntimeRPCProvider,
  RuntimeSourceProvider,
  StateStore,
  LogProgress,
} from '../interfaces/core.js';
import JSZip from 'jszip';
import type { TypedPackage } from '../types/TypedPackage.js';
import type { TypedOwnableInfo } from '../types/TypedOwnableInfo.js';
import { ConsumptionEvidencePendingError } from '../types/OwnableRuntime.js';
import type {
  ConsumptionVerificationOptions,
  ConsumeIngestEvent,
  CosmWasmMessageInfo,
  CosmWasmEvent,
  EmittedPublicEventReceipt,
  EventAttachmentInput,
  OwnableEvent,
  PublicEvent,
  OwnableRPC,
  RuntimePublicEvent,
  SignedConsumeIngestEvent,
  StateDump,
  StateSnapshot,
} from '../types/OwnableRuntime.js';
import type {
  IndexedPublicEvent,
  IndexedPublicEventTransportOrigin,
  IndexedPublicReplaySelectionOptions,
  PublicEventInsertionAnchor,
  ReconciledPublicEvent,
  ReplayAttemptResult,
} from '../types/Replay.js';
import EventChainService from './EventChain.service.js';
import type { LoggerLike } from '../logger.js';
import { PublicEventReplayService } from './ReplayAuthority.service.js';
import { ProgressService } from './Progress.service.js';
import type { AnchorValidationResult } from '../types/AnchorValidation.js';
import { calculateOwnablePackageCid } from '../utils/calculateOwnablePackageCid.js';
import {
  OWNABLE_ATTACHMENT_PREFIX,
  assertAttachmentCid,
  collectOwnableAttachments,
  createConsumptionSnapshot,
  readConsumptionSnapshot,
  serializeOwnableChain,
} from '../utils/ownableArchive.js';

const ATTACHMENT_STORE = 'ownable-attachments';
const MAX_PROOF_DEPTH = 16;
const MAX_PROOF_BYTES = 256 * 1024 * 1024;

interface ReplayedConsume {
  id: string;
  owner: string;
  issuer: string;
  event: string;
  target: string;
  attributes: TypedDict<string>;
}

interface ConsumptionReplayContext {
  options: ConsumptionVerificationOptions;
  remainingBytes: number;
  attachments: Map<string, Uint8Array>;
  completed: Map<string, ReplayedConsume>;
  active: Set<string>;
  verified: boolean;
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${description}`);
  return value;
}

function attributesOf(value: unknown): TypedDict<string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid consume attributes');
  }
  const entries = Object.entries(value);
  if (entries.some(([, attribute]) => typeof attribute !== 'string')) {
    throw new Error('Invalid consume attribute value');
  }
  return Object.fromEntries(entries);
}

function readConsumeIngest(message: TypedDict): SignedConsumeIngestEvent {
  if (message.type !== 'consume') throw new Error('Invalid consume ingest type');
  const { source, target } = message;
  return {
    type: 'consume',
    source: {
      id: requireString(source?.id, 'consume source ID'),
      owner: requireString(source?.owner, 'consume source owner'),
      issuer: requireString(source?.issuer, 'consume source issuer'),
      event: requireString(source?.event, 'consume source event'),
      cid: requireString(source?.cid, 'consume snapshot CID'),
    },
    target: { id: requireString(target?.id, 'consume target ID') },
    attributes: attributesOf(message.attributes),
  };
}

function consumeRpcPayload(event: SignedConsumeIngestEvent): ConsumeIngestEvent {
  const { cid: _cid, ...source } = event.source;
  return { type: event.type, source, target: event.target, attributes: event.attributes };
}

function isBoundIngest(message: TypedDict): boolean {
  return (
    message['@context'] === 'ingest_msg.json' &&
    (message.type === 'consume' || message.source?.cid !== undefined)
  );
}

function isLegacyConsume(message: TypedDict): boolean {
  return message['@context'] === 'ingest_msg.json' && message.eventType === 'consume';
}

function attributesMatch(left: TypedDict<string>, right: TypedDict<string>): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([key, value]) => Object.hasOwn(right, key) && right[key] === value)
  );
}

function consumeAttributes(events: CosmWasmEvent[], target: string): TypedDict<string> {
  const [emitted, ...others] = events.filter((event) => event.type === 'consume');
  if (!emitted) throw new Error('No consume event emitted');
  if (others.length) throw new Error('Multiple consume events emitted');
  const { consumer_id: destination, ...attributes } = attributesOf(emitted.attributes);
  if (destination !== undefined && destination !== target) {
    throw new Error('Emitted consume destination differs from the signed command');
  }
  return attributes;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

interface LogPosition {
  blockNumber?: number;
  transactionIndex?: number;
  logIndex?: number;
}

function compareLogPosition(left: LogPosition, right: LogPosition): number {
  if (
    left.blockNumber === undefined ||
    right.blockNumber === undefined ||
    left.transactionIndex === undefined ||
    right.transactionIndex === undefined ||
    left.logIndex === undefined ||
    right.logIndex === undefined
  ) {
    throw new Error('Missing indexed log position for consumption replay');
  }
  return (
    left.blockNumber - right.blockNumber ||
    left.transactionIndex - right.transactionIndex ||
    left.logIndex - right.logIndex
  );
}

function samePublicEvent(left: PublicEvent, right: PublicEvent): boolean {
  return (
    sameAddress(left.source, right.source) &&
    left.eventType === right.eventType &&
    left.data.toLowerCase() === right.data.toLowerCase() &&
    left.transactionHash.toLowerCase() === right.transactionHash.toLowerCase() &&
    compareLogPosition(left, right) === 0
  );
}

export interface OwnableServiceDependencies {
  stateStore: StateStore;
  eventChains: EventChainService;
  anchorProvider: AnchorProvider;
  packages: PackageAssetIO;
  runtimeSource: RuntimeSourceProvider;
  runtimeRpc: RuntimeRPCProvider;
  replay: PublicEventReplayService;
  logger?: LoggerLike;
  consumption?: ConsumptionVerificationOptions;
}

export default class OwnableService {
  private readonly SNAPSHOT_INTERVAL = 50;
  private readonly PUBLIC_EVENT_REPLAY_STORE_SUFFIX = '.public-event-replays';

  private readonly stateStore: StateStore;
  private readonly eventChains: EventChainService;
  private readonly eqty: AnchorProvider;
  private readonly packages: PackageAssetIO;
  private readonly runtimeSource: RuntimeSourceProvider;
  private readonly runtimeRpc: RuntimeRPCProvider;
  private readonly replay: PublicEventReplayService;
  private readonly logger: LoggerLike;
  private readonly consumption: ConsumptionVerificationOptions | undefined;
  private readonly ownableWrites = new Map<string, Promise<void>>();
  private readonly queuedConsumptionAnchors = new Set<string>();
  private archiveWorkerId = 0;

  constructor(deps: OwnableServiceDependencies) {
    this.stateStore = deps.stateStore;
    this.eventChains = deps.eventChains;
    this.eqty = deps.anchorProvider;
    this.packages = deps.packages;
    this.runtimeSource = deps.runtimeSource;
    this.runtimeRpc = deps.runtimeRpc;
    this.replay = deps.replay;
    this.logger = deps.logger ?? console;
    this.consumption = deps.consumption;
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
    const wasm = (await this.packages.getAsset(cid, 'ownable_bg.wasm', (fr, file) =>
      (fr as FileReader).readAsArrayBuffer(file as Blob | File)
    )) as ArrayBuffer;

    const rpc = this.runtimeRpc.create(id);
    await rpc.initialize(js, new Uint8Array(wasm));
    this._rpc.set(id, rpc);
  }

  async create(
    pkg: TypedPackage,
    onProgress?: LogProgress
  ): Promise<{ chain: EventChain; txHash?: string }> {
    const progress = new ProgressService(onProgress);
    const address = this.eqty.address;
    const networkId = this.eqty.chainId;
    const chain = EventChain.create(address, networkId);
    const anchors: Array<any> = [];

    if (pkg.isDynamic || this.anchoring) {
      const msg: any = {
        '@context': 'instantiate_msg.json',
        ownable_id: chain.id,
        package: pkg.cid,
        network_id: networkId,
        keywords: pkg.keywords ?? [],
        ...(pkg.title ? { name: pkg.title } : {}),
        ...(pkg.description ? { description: pkg.description } : {}),
      };

      await progress.step('signEvent', () => this.eqty.sign(new Event(msg).addTo(chain)));
    }

    if (this.anchoring) {
      const hash = chain.latestHash.hex;
      anchors.push(...chain.startingWith(Binary.fromHex(hash)).anchorMap);
    }

    if (anchors.length > 0) {
      // Queue anchors and submit as single tx
      await this.eqty.anchor(...anchors);
      const txHash = await progress.step('anchorEvent', () => this.eqty.submitAnchors());
      return txHash ? { chain, txHash } : { chain };
    }

    return { chain };
  }

  async init(chain: EventChain, cid: string, uniqueMessageHash?: string): Promise<EventChain> {
    return this.withOwnableWrites([chain.id], async () => {
      const storeId = `ownable:${chain.id}`;
      const stored = (await this.stateStore.hasStore(storeId))
        ? await this.stateStore.get(storeId, 'chain')
        : undefined;
      const current = stored ? EventChain.from(stored) : undefined;
      if (current) {
        const sharedLength = Math.min(chain.events.length, current.events.length);
        for (let index = 0; index < sharedLength; index++) {
          if (chain.events[index]?.hash.hex !== current.events[index]?.hash.hex) {
            throw new Error('Imported Ownable conflicts with the installed chain');
          }
        }
        if (current.events.length >= chain.events.length) {
          const installedPackage = await this.stateStore.get(storeId, 'package');
          await this.initWorker(current.id, installedPackage);
          return current;
        }
      }
      const hasProofs = OwnableService.hasBoundConsumptionClaims(chain);
      if (this.consumption && chain.events.length && !hasProofs) {
        if (this.consumePackageCid(chain) !== cid) {
          throw new Error('Imported package does not match the signed Ownable chain');
        }
        await this.verifyChainSignatures(chain, this.consumption);
      }
      if (hasProofs && this.consumePackageCid(chain) !== cid) {
        throw new Error('Imported package does not match the signed Ownable chain');
      }
      const verifiedState = hasProofs ? await this.verifyConsumptionChain(chain) : undefined;
      await this.initWorker(chain.id, cid);
      const stateDump = verifiedState ?? (await this.apply(chain, []));
      if (current) {
        await this.writeChain(chain, stateDump, false);
      } else {
        await this.initStore(chain, cid, uniqueMessageHash, stateDump);
      }
      return chain;
    });
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
          .map((key) => parseInt(key.replace('snapshot_', '')))
          .sort((a, b) => b - a);

        // Delete oldest snapshots, keep the 3 most recent
        const keysToDelete = sortedKeys.slice(3).map((index) => `snapshot_${index}`);

        for (const key of keysToDelete) {
          await this.stateStore.delete(snapshotStoreId, key);
        }
      }
    } catch (error) {
      this.logger.error('Error creating snapshot:', error);
    }
  }

  private async getLatestSnapshot(chainId: string): Promise<StateSnapshot | null> {
    const storeId = `ownable:${chainId}`;
    const snapshotStoreId = `${storeId}.snapshots`;
    const exist = await this.stateStore.hasStore(snapshotStoreId);

    if (!exist) {
      return null;
    }

    const snapshots = await this.stateStore.keys(snapshotStoreId);
    if (snapshots.length === 0) return null;

    const latestKey = snapshots
      .map((key) => parseInt(key.replace('snapshot_', '')))
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
      .map((key) => parseInt(key.replace('snapshot_', '')))
      .sort((a, b) => a - b);

    return Promise.all(
      sortedKeys.map((index) => this.stateStore.get(snapshotStoreId, `snapshot_${index}`))
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
    status: ReconciledPublicEvent['status'],
    sources: IndexedPublicEventTransportOrigin[],
    details: Pick<
      ReconciledPublicEvent,
      'localApplicationState' | 'localDisplayError' | 'insertionAnchor' | 'registerEventHash'
    > = {}
  ): ReconciledPublicEvent {
    return {
      replayKey: this.replay.key(event),
      event,
      status,
      sources: [...new Set(sources)],
      ...details,
    };
  }

  private mergeReplayRecordSources(
    current: IndexedPublicEventTransportOrigin[],
    next: IndexedPublicEventTransportOrigin
  ): IndexedPublicEventTransportOrigin[] {
    return current.includes(next) ? current : [...current, next];
  }

  private replayRecordPersistenceDetails(
    record?: ReconciledPublicEvent
  ): Pick<ReconciledPublicEvent, 'insertionAnchor' | 'registerEventHash'> {
    return {
      ...(record?.insertionAnchor ? { insertionAnchor: record.insertionAnchor } : {}),
      ...(record?.registerEventHash ? { registerEventHash: record.registerEventHash } : {}),
    };
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
    return records
      .filter((record) => !record.replayKey.startsWith('pending:'))
      .sort((left, right) => {
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
      status: 'pending',
      sources: ['local'],
      localApplicationState: 'pending',
    };
  }

  private async publicEventInsertionAnchor(chain: EventChain): Promise<PublicEventInsertionAnchor> {
    const privateEventCount = chain.events.length;
    const privateEventHash = chain.events.at(-1)?.hash?.hex ?? chain.latestHash.hex;
    const records = await this.listReplayRecords(chain.id);
    const ordinal = records.reduce((nextOrdinal, record) => {
      const anchor = record.insertionAnchor;
      return anchor &&
        anchor.privateEventCount === privateEventCount &&
        anchor.privateEventHash === privateEventHash
        ? Math.max(nextOrdinal, anchor.ordinal + 1)
        : nextOrdinal;
    }, 0);

    return { privateEventCount, privateEventHash, ordinal };
  }

  private localDisplayError(cause: unknown): string {
    const message = cause instanceof Error ? cause.message : String(cause);
    return message.slice(0, 280) || 'Unable to apply public event locally';
  }

  private signedRegisterEventHash(
    chain: EventChain,
    event: IndexedPublicEvent
  ): string | undefined {
    const replayKey = this.replay.key(event);
    const registerEvent = chain.events.find((candidate) => {
      if (!candidate.isSigned()) return false;
      const data = candidate.parsedData as Partial<PublicEvent> & { '@context'?: string };
      return (
        data['@context'] === 'register_msg.json' &&
        data.transactionHash !== undefined &&
        data.logIndex !== undefined &&
        this.replay.key({
          ...event,
          transactionHash: data.transactionHash,
          logIndex: data.logIndex,
        }) === replayKey
      );
    });
    return registerEvent?.hash.hex;
  }

  private async applyPublicEventToChain(
    chain: EventChain,
    event: PublicEvent,
    stateDump: StateDump,
    progress: ProgressService
  ): Promise<{ stateDump: StateDump; registerEventHash?: string }> {
    const info: CosmWasmMessageInfo = {
      sender: this.eqty.address,
      funds: [],
    };
    const candidate = EventChain.from(chain.toJSON());
    const { state } = await this.rpc(chain.id).register(
      this.toRegisterRpcPayload(event),
      info,
      stateDump
    );
    const registerEvent = new Event({
      '@context': 'register_msg.json',
      ...event,
    });
    registerEvent.addTo(candidate);
    try {
      await progress.step('signPublicEvent', () => this.eqty.sign(registerEvent));
      await this.store(candidate, state);
      chain.events = candidate.events;
    } catch (cause) {
      const persistedChain = await this.stateStore
        .get(`ownable:${chain.id}`, 'chain')
        .catch(() => undefined);
      if (persistedChain && registerEvent.isSigned()) {
        const recoveredChain = EventChain.from(persistedChain);
        const persistedEvent = recoveredChain.events.find(
          (stored) => stored.isSigned() && stored.hash.hex === registerEvent.hash.hex
        );
        if (persistedEvent) {
          chain.events = recoveredChain.events;
          return { stateDump: state, registerEventHash: persistedEvent.hash.hex };
        }
      }
      throw cause;
    }

    return {
      stateDump: state,
      ...(registerEvent.isSigned() ? { registerEventHash: registerEvent.hash.hex } : {}),
    };
  }

  private toRegisterRuntimeEvent(
    event: Omit<PublicEvent, 'data'> & { data: string | Uint8Array | Binary; subjectId?: string }
  ): PublicEvent {
    const {
      subjectId: _subjectId,
      timestamp: _timestamp,
      ...publicEvent
    } = event as typeof event & {
      timestamp?: number;
    };
    return {
      ...publicEvent,
      data: typeof publicEvent.data === 'string' ? publicEvent.data : new Binary(event.data).hex,
    };
  }

  private publicEventSubjectMatches(
    chain: EventChain,
    event: Pick<EmittedPublicEventReceipt, 'subjectId'>
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

  static hasConsumptionClaims(chain: EventChain): boolean {
    return chain.events.some(
      ({ parsedData }) => isBoundIngest(parsedData) || isLegacyConsume(parsedData)
    );
  }

  static hasBoundConsumptionClaims(chain: EventChain): boolean {
    return chain.events.some((event) => event && isBoundIngest(event.parsedData));
  }

  async verifyConsumptionChain(
    chain: EventChain,
    options = this.consumption,
    packageVerifiedWasm?: Uint8Array
  ): Promise<StateDump> {
    const result = await this.replayConsumptionChain(chain, options, packageVerifiedWasm);
    if (!result.verified) throw new ConsumptionEvidencePendingError();
    return result.stateDump;
  }

  async replayConsumptionChain(
    chain: EventChain,
    options = this.consumption,
    packageVerifiedWasm?: Uint8Array
  ): Promise<{ stateDump: StateDump; verified: boolean; appliedPublicReplayKeys: string[] }> {
    if (!options) throw new Error('Consumption verification is not configured');
    const context: ConsumptionReplayContext = {
      options,
      remainingBytes: options.maxSnapshotBytes ?? MAX_PROOF_BYTES,
      attachments: new Map(),
      completed: new Map(),
      active: new Set(),
      verified: true,
    };
    // Callers providing WASM directly must have checked all of the root package assets over the signed package CID.
    const packageCid = this.consumePackageCid(chain);
    const wasm = packageVerifiedWasm ?? (await this.packageWasm(packageCid));
    const { stateDump, appliedPublicReplayKeys } = await this.replayProofChain(
      chain,
      wasm,
      context,
      0
    );
    return { stateDump, verified: context.verified, appliedPublicReplayKeys };
  }

  private consumePackageCid(chain: EventChain): string {
    const genesis = chain.events[0]?.parsedData;
    if (
      chain.isPartial() ||
      genesis?.['@context'] !== 'instantiate_msg.json' ||
      genesis.ownable_id !== chain.id ||
      (genesis.network_id !== undefined && genesis.network_id !== chain.networkId)
    ) {
      throw new Error('Invalid Ownable genesis in consumption proof');
    }
    return requireString(genesis.package, 'Ownable genesis package CID');
  }

  private async verifyChainSignatures(chain: EventChain, options: ConsumptionVerificationOptions) {
    // eqty-core reconstructs the network from the chain ID but JSON events default to network zero.
    for (const event of chain.events) event.networkId = chain.networkId;
    await chain.validate(options.verifySignature);
  }

  private async packageWasm(cid: string): Promise<Uint8Array> {
    const zip: JSZip = await this.packages.zip(cid);
    const files = await Promise.all(
      Object.values(zip.files)
        .filter((file) => !file.dir)
        .map(async (file) => ({ path: file.name, content: await file.async('uint8array') }))
    );
    if ((await calculateOwnablePackageCid(files)) !== cid) {
      throw new Error('Ownable runtime package does not match its signed CID');
    }
    const wasm = files.find(({ path }) => path === 'ownable_bg.wasm')?.content;
    if (!wasm) throw new Error('Ownable runtime package is missing its WASM');
    return wasm;
  }

  private async proofAttachment(
    cid: string,
    context: ConsumptionReplayContext,
    inline?: Uint8Array
  ) {
    if (inline) await assertAttachmentCid(cid, inline);
    const cached = context.attachments.get(cid);
    if (cached) return cached;
    const bytes = inline ?? (await context.options.getAttachment(cid));
    if (!bytes) throw new Error(`Missing consumption attachment ${cid}`);
    context.remainingBytes -= bytes.byteLength;
    if (context.remainingBytes < 0 || context.attachments.size >= 10_000) {
      throw new Error('Consumption proof exceeds its size limit');
    }
    if (!inline) await assertAttachmentCid(cid, bytes);
    context.attachments.set(cid, bytes);
    return bytes;
  }

  private async validateProofAnchors(chain: EventChain, context: ConsumptionReplayContext) {
    const evidence = await context.options.verifyAnchors(chain);
    for (const pair of chain.anchorMap) {
      const record = evidence.details[pair.key.hex];
      if (!record?.transactionHash) {
        context.verified = false;
      } else if (!record.verified || record.value.toLowerCase() !== pair.value.hex.toLowerCase()) {
        throw new Error(`Ownable ${chain.id} has contradictory authoritative anchor evidence`);
      }
    }
    if (!evidence.verified) context.verified = false;
    return evidence;
  }

  private async validateDossierAttachments(event: Event, context: ConsumptionReplayContext) {
    const attachments = event.parsedData.attach?.attachments;
    if (!Array.isArray(attachments)) return;
    for (const attachment of attachments) {
      const cid = requireString(attachment?.cid, 'Dossier attachment CID');
      const inline = event.attachments.find((item) => item.name === cid);
      await this.proofAttachment(cid, context, inline?.data);
    }
  }

  private proofPublicEvents(
    chain: EventChain,
    events: IndexedPublicEvent[],
    context: ConsumptionReplayContext
  ) {
    const indexed = this.replay.dedupe(events).events;
    const registered = new Set<string>();
    const byKey = new Map(indexed.map((event) => [this.replay.key(event), event]));
    for (const event of chain.events) {
      if (event.parsedData['@context'] !== 'register_msg.json') continue;
      const message = event.parsedData as PublicEvent;
      const key = this.replay.key(message);
      const authoritative = byKey.get(key);
      if (registered.has(key) || (authoritative && !samePublicEvent(message, authoritative))) {
        throw new Error('Signed register event disagrees with authoritative public evidence');
      }
      if (!authoritative) context.verified = false;
      registered.add(key);
    }
    return {
      unregistered: indexed.filter((event) => !registered.has(this.replay.key(event))),
      registered: [...registered],
    };
  }

  private publicEventsBeforeNextAnchor(
    events: IndexedPublicEvent[],
    anchors: AnchorValidationResult,
    keys: EventChain['anchorMap']
  ): Map<number, IndexedPublicEvent[]> {
    const byPrivateIndex = new Map<number, IndexedPublicEvent[]>();
    if (!events.length) return byPrivateIndex;
    if (!anchors.verified) throw new ConsumptionEvidencePendingError();
    const positions = keys.map(({ key }) => anchors.details[key.hex]!);
    const genesis = positions[0]!;
    for (let index = 1; index < positions.length; index++) {
      if (compareLogPosition(positions[index - 1]!, positions[index]!) >= 0) {
        throw new Error('Authoritative anchors do not order this chain against public events');
      }
    }
    let index = 1;
    for (const event of events) {
      if (compareLogPosition(event, genesis) <= 0) continue;
      while (index < positions.length && compareLogPosition(event, positions[index]!) >= 0) index++;
      if (index === positions.length) break;
      const before = byPrivateIndex.get(index) ?? [];
      before.push(event);
      byPrivateIndex.set(index, before);
    }
    return byPrivateIndex;
  }

  private async replayProofChain(
    chain: EventChain,
    wasm: Uint8Array,
    context: ConsumptionReplayContext,
    depth: number
  ): Promise<{
    stateDump: StateDump;
    consume?: ReplayedConsume;
    appliedPublicReplayKeys: string[];
  }> {
    this.consumePackageCid(chain);
    await this.verifyChainSignatures(chain, context.options);
    const anchors = await this.validateProofAnchors(chain, context);
    const publicEvents = this.proofPublicEvents(
      chain,
      await context.options.getPublicEvents(chain, anchors),
      context
    );
    const publicBefore = this.publicEventsBeforeNextAnchor(
      publicEvents.unregistered,
      anchors,
      chain.anchorMap
    );
    const appliedPublicReplayKeys = publicEvents.registered;
    const used = new Set<string>();
    const rpc = this.runtimeRpc.create(`${chain.id}:proof:${++this.archiveWorkerId}`);
    let stateDump: StateDump = [];
    let consume: ReplayedConsume | undefined;
    try {
      await rpc.initialize(this.runtimeSource.getWorkerSource(), wasm);
      for (const [index, event] of chain.events.entries()) {
        for (const external of publicBefore.get(index) ?? []) {
          const payload = this.toRegisterRpcPayload(this.toRegisterRuntimeEvent(external));
          const info = { sender: external.source, funds: [] };
          stateDump = (await rpc.register(payload, info, stateDump)).state;
          appliedPublicReplayKeys.push(this.replay.key(external));
        }
        const { '@context': kind, ...message } = event.parsedData;
        const info = { sender: event.signerAddress!, funds: [] };
        switch (kind) {
          case 'instantiate_msg.json':
            if (index !== 0) throw new Error('Repeated Ownable genesis in consumption proof');
            stateDump = (await rpc.instantiate(message, info)).state;
            break;
          case 'execute_msg.json': {
            await this.validateDossierAttachments(event, context);
            const result = await rpc.execute(message, info, stateDump);
            stateDump = result.state;
            if (index === chain.events.length - 1 && message.consume?.consumer_id !== undefined) {
              const target = requireString(message.consume.consumer_id, 'signed consumer ID');
              const { owner, issuer } = (await rpc.query(
                { get_info: {} },
                stateDump
              )) as TypedOwnableInfo;
              consume = {
                id: chain.id,
                owner,
                issuer,
                event: event.hash.hex,
                target,
                attributes: consumeAttributes(result.events, target),
              };
            }
            break;
          }
          case 'register_msg.json': {
            const payload = this.toRegisterRpcPayload(message as PublicEvent);
            stateDump = (await rpc.register(payload, info, stateDump)).state;
            break;
          }
          case 'ingest_msg.json': {
            if (isLegacyConsume(event.parsedData) && !isBoundIngest(event.parsedData)) {
              throw new Error('Historical consume event has no verification proof');
            }
            let payload = message as OwnableEvent;
            if (isBoundIngest(event.parsedData)) {
              const claim = readConsumeIngest(message);
              const identity = `${claim.source.id}:${claim.source.event}`;
              if (used.has(identity))
                throw new Error('Duplicate consume event in the receiving chain');
              used.add(identity);
              await this.verifyIngestProof(chain.id, claim, context, depth + 1);
              payload = consumeRpcPayload(claim);
            }
            stateDump = (await rpc.ingest(payload, info, stateDump)).state;
            break;
          }
          default:
            throw new Error('Unknown Ownable event in consumption proof');
        }
      }
      return { stateDump, appliedPublicReplayKeys, ...(consume ? { consume } : {}) };
    } finally {
      rpc.terminate();
    }
  }

  private async verifyIngestProof(
    receivingId: string,
    claim: SignedConsumeIngestEvent,
    context: ConsumptionReplayContext,
    depth: number
  ): Promise<void> {
    if (claim.target.id !== receivingId || claim.source.id === receivingId) {
      throw new Error('Consume target does not match the receiving Ownable');
    }
    const { cid, id, event, owner, issuer } = claim.source;
    if (depth > MAX_PROOF_DEPTH || context.active.has(cid)) {
      throw new Error('Cyclic or deeply nested consumption proof');
    }
    let actual = context.completed.get(cid);
    if (!actual) {
      context.active.add(cid);
      try {
        const bytes = await this.proofAttachment(cid, context);
        const snapshot = await readConsumptionSnapshot(bytes, {
          maxExpandedBytes: context.remainingBytes,
        });
        context.remainingBytes -= snapshot.expandedBytes;
        const chain = snapshot.chain;
        const packageCid = this.consumePackageCid(chain);
        const terminal = chain.events.at(-1);
        if (
          chain.id !== id ||
          terminal?.hash.hex !== event ||
          terminal.parsedData['@context'] !== 'execute_msg.json' ||
          terminal.parsedData.consume?.consumer_id !== receivingId
        ) {
          throw new Error(
            'Snapshot does not end at the signed consume command bound to the receiver'
          );
        }
        const calculated = await calculateOwnablePackageCid(
          Array.from(snapshot.assets, ([path, content]) => ({ path, content }))
        );
        const wasm = snapshot.assets.get('ownable_bg.wasm');
        if (calculated !== packageCid || !wasm) {
          throw new Error('Consumption snapshot runtime package does not match its signed CID');
        }
        actual = (await this.replayProofChain(chain, wasm, context, depth)).consume;
        if (!actual) throw new Error('Snapshot has no verified terminal consume result');
        context.completed.set(cid, actual);
      } finally {
        context.active.delete(cid);
      }
    }
    if (
      actual.id !== id ||
      actual.event !== event ||
      actual.target !== receivingId ||
      !sameAddress(actual.owner, owner) ||
      !sameAddress(actual.issuer, issuer) ||
      !attributesMatch(actual.attributes, claim.attributes)
    ) {
      throw new Error('Signed consume claim differs from the verified source result');
    }
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
    const { '@context': context, ...msg } = event.parsedData;

    let result;
    switch (context) {
      case 'instantiate_msg.json':
        result = await rpc.instantiate(msg, info);
        break;
      case 'execute_msg.json':
        result = await rpc.execute(msg, info, stateDump);
        break;
      case 'register_msg.json':
        result = await rpc.register(this.toRegisterRpcPayload(msg as PublicEvent), info, stateDump);
        break;
      case 'ingest_msg.json':
        if (isBoundIngest(event.parsedData))
          throw new Error('Consumption requires full-chain verification');
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

  async apply(partialChain: EventChain, stateDump: StateDump): Promise<StateDump> {
    if (OwnableService.hasBoundConsumptionClaims(partialChain)) {
      if (!partialChain.isPartial()) return this.verifyConsumptionChain(partialChain);
      const stored = await this.stateStore.get(`ownable:${partialChain.id}`, 'chain');
      if (!stored) throw new Error('Consumption requires the receiving chain from genesis');
      const fullChain = EventChain.from(stored);
      fullChain.add(partialChain);
      return this.verifyConsumptionChain(fullChain);
    }
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

    for (let batchStart = startIndex; batchStart < totalEvents; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalEvents);
      const batch = partialChain.events.slice(batchStart, batchEnd);

      for (let i = 0; i < batch.length; i++) {
        const globalIndex = batchStart + i;
        const event = batch[i];
        if (!event) continue;

        try {
          const result = await this.applyEvent(rpc, event, stateDump, partialChain, globalIndex);
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
          reason: 'register_failed',
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
    return this.reconcileIndexedPublicEvents(chain, indexedPublicEvents, 'snapshot', onProgress);
  }

  async applyIndexedPublicEventStream(
    chain: EventChain,
    indexedPublicEvents: IndexedPublicEvent[],
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    return this.reconcileIndexedPublicEvents(chain, indexedPublicEvents, 'stream', onProgress);
  }

  private async reconcileIndexedPublicEvents(
    chain: EventChain,
    indexedPublicEvents: IndexedPublicEvent[],
    source: IndexedPublicEventTransportOrigin,
    onProgress?: LogProgress
  ): Promise<ReplayAttemptResult> {
    const progress = new ProgressService(onProgress);
    const stateDump = await this.eventChains.getStateDump(chain.id, chain.state.hex);
    if (!stateDump) throw Error('State mismatch for register public event');

    const replayStoreId = await this.ensureReplayStore(chain.id);
    const base = this.emptyReplayAttemptResult(stateDump);
    const deduped = this.replay.dedupe(indexedPublicEvents);

    base.duplicateReplayKeys.push(...deduped.duplicateReplayKeys);
    base.duplicatePublicEvents.push(
      ...deduped.duplicateEvents.map((event) => this.replayRecord(event, 'confirmed', [source]))
    );

    let nextState = stateDump;

    for (const indexedEvent of deduped.events) {
      const replayKey = this.replay.key(indexedEvent);
      const existing = (await this.stateStore
        .get(replayStoreId, replayKey)
        .catch(() => undefined)) as ReconciledPublicEvent | undefined;

      if (existing?.status === 'confirmed') {
        const updated = this.replayRecord(
          existing.event,
          'confirmed',
          this.mergeReplayRecordSources(existing.sources, source),
          {
            localApplicationState: existing.localApplicationState ?? 'applied',
            ...this.replayRecordPersistenceDetails(existing),
          }
        );
        await this.stateStore.set(replayStoreId, replayKey, updated);
        base.duplicateReplayKeys.push(replayKey);
        base.duplicatePublicEvents.push(updated);
        continue;
      }

      if (existing?.localApplicationState === 'applied') {
        const confirmedRecord = this.replayRecord(
          indexedEvent,
          'confirmed',
          this.mergeReplayRecordSources(existing.sources, source),
          {
            localApplicationState: 'applied',
            ...this.replayRecordPersistenceDetails(existing),
          }
        );
        await this.stateStore.set(replayStoreId, replayKey, confirmedRecord);
        base.confirmedPendingPublicEvents.push(confirmedRecord);
        continue;
      }

      const signedRegisterEventHash = this.signedRegisterEventHash(chain, indexedEvent);
      if (signedRegisterEventHash) {
        const confirmedRecord = this.replayRecord(
          indexedEvent,
          'confirmed',
          existing ? this.mergeReplayRecordSources(existing.sources, source) : [source],
          {
            localApplicationState: 'applied',
            ...this.replayRecordPersistenceDetails(existing),
            registerEventHash: signedRegisterEventHash,
          }
        );
        await this.stateStore.set(replayStoreId, replayKey, confirmedRecord);
        if (existing?.status === 'pending') {
          base.confirmedPendingPublicEvents.push(confirmedRecord);
        }
        continue;
      }

      const runtimeEvent = this.toRegisterRuntimeEvent(indexedEvent);
      try {
        const applied = await this.applyPublicEventToChain(
          chain,
          runtimeEvent,
          nextState,
          progress
        );
        nextState = applied.stateDump;

        const confirmedRecord = this.replayRecord(
          indexedEvent,
          'confirmed',
          existing?.status === 'pending'
            ? this.mergeReplayRecordSources(existing.sources, source)
            : [source],
          {
            localApplicationState: 'applied',
            ...this.replayRecordPersistenceDetails(existing),
            ...(applied.registerEventHash ? { registerEventHash: applied.registerEventHash } : {}),
          }
        );
        await this.stateStore.set(replayStoreId, replayKey, confirmedRecord);

        base.appliedEvents.push(indexedEvent);
        base.appliedReplayKeys.push(replayKey);
        base.appliedPublicEvents.push({ replayKey, event: indexedEvent });
        if (existing?.status === 'pending') {
          base.confirmedPendingPublicEvents.push(confirmedRecord);
        }
      } catch (cause) {
        if (existing?.status === 'pending') {
          const failedRecord = this.replayRecord(
            existing.event,
            'pending',
            this.mergeReplayRecordSources(existing.sources, source),
            {
              localApplicationState: 'failed',
              localDisplayError: this.localDisplayError(cause),
              ...this.replayRecordPersistenceDetails(existing),
            }
          );
          await this.stateStore.set(replayStoreId, replayKey, failedRecord);
          base.pendingPublicEvents.push(failedRecord);
        }
        base.ignoredPublicEvents.push({
          replayKey,
          event: indexedEvent,
          reason: 'register_failed',
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
    const progress = new ProgressService(onProgress);
    const candidate = EventChain.from(chain.toJSON());
    const info = { sender: this.eqty.address, funds: [] } as CosmWasmMessageInfo;
    const { '@context': _context, ...message } = msg;
    const { state: newStateDump } = await this.rpc(chain.id).execute(message, info, stateDump);
    const event = new Event({ '@context': 'execute_msg.json', ...message }).addTo(candidate);
    const declaredAttachments = message.attach?.attachments;
    const signedCids = new Set<string>();
    if (Array.isArray(declaredAttachments)) {
      for (const attachment of declaredAttachments) {
        signedCids.add(requireString(attachment?.cid, 'Dossier attachment CID'));
      }
    }
    const referenced = new Map<string, Uint8Array>();
    const attachmentTypes = new Map<string, string>();
    for (const attachment of attachments) {
      const bytes = new Uint8Array(await attachment.file.arrayBuffer());
      if (signedCids.has(attachment.name)) {
        await assertAttachmentCid(attachment.name, bytes);
        referenced.set(attachment.name, bytes);
        attachmentTypes.set(attachment.name, attachment.file.type);
      } else {
        event.addAttachment(
          attachment.name,
          bytes,
          attachment.file.type || 'application/octet-stream'
        );
      }
    }
    for (const cid of signedCids) {
      if (referenced.has(cid)) continue;
      const bytes = await this.getAttachment(cid);
      if (!bytes) throw new Error(`Missing Dossier attachment ${cid}`);
      await assertAttachmentCid(cid, bytes);
    }

    await progress.step('signEvent', () => this.eqty.sign(event));
    if (referenced.size) await this.putAttachments(referenced, attachmentTypes);

    // Store without submitting anchors yet; submission is controlled by caller
    await this.store(candidate, newStateDump);
    chain.events = candidate.events;

    return newStateDump;
  }

  async registerPublicEvent(
    chain: EventChain,
    event: Omit<PublicEvent, 'data'> & { data: string | Uint8Array | Binary; subjectId?: string },
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
    const progress = new ProgressService(onProgress);
    const stateDump = await this.eventChains.getStateDump(chain.id, chain.state.hex);
    if (!stateDump) throw Error('State mismatch for emit public event');

    const encodedPayload = await progress.step('encodePublicEvent', () =>
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
      publicEvent = await progress.step('emitPublicEvent', () =>
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
        reason: 'invalid_subject_id',
        cause: {
          expectedSubjectId: subjectId,
          receivedSubjectId: publicEvent.subjectId,
        },
      });
      return result;
    }

    const runtimeEvent = this.toRegisterRuntimeEvent(publicEvent);
    const insertionAnchor = await this.publicEventInsertionAnchor(chain);
    const pendingRecord = this.replayRecord(runtimeEvent, 'pending', ['local'], {
      localApplicationState: 'pending',
      insertionAnchor,
    });
    await this.stateStore.delete(replayStoreId, provisionalPendingRecord.replayKey);
    await this.stateStore.set(replayStoreId, pendingRecord.replayKey, pendingRecord);

    let applied: { stateDump: StateDump; registerEventHash?: string };
    try {
      applied = await this.applyPublicEventToChain(chain, runtimeEvent, stateDump, progress);
    } catch (cause) {
      const failedRecord = this.replayRecord(runtimeEvent, 'pending', ['local'], {
        localApplicationState: 'failed',
        localDisplayError: this.localDisplayError(cause),
        insertionAnchor,
      });
      await this.stateStore.set(replayStoreId, failedRecord.replayKey, failedRecord);

      const result = this.emptyReplayAttemptResult(stateDump);
      result.complete = false;
      result.pendingPublicEvents.push(failedRecord);
      result.ignoredPublicEvents.push({
        replayKey: failedRecord.replayKey,
        event: runtimeEvent,
        reason: 'register_failed',
        cause,
      });
      return result;
    }

    const appliedRecord = this.replayRecord(runtimeEvent, 'pending', ['local'], {
      localApplicationState: 'applied',
      insertionAnchor,
      ...(applied.registerEventHash ? { registerEventHash: applied.registerEventHash } : {}),
    });
    try {
      await this.stateStore.set(replayStoreId, appliedRecord.replayKey, appliedRecord);
    } catch (cause) {
      const persistedRecord = (await this.stateStore
        .get(replayStoreId, appliedRecord.replayKey)
        .catch(() => undefined)) as ReconciledPublicEvent | undefined;
      if (persistedRecord?.localApplicationState === 'applied') {
        return this.localAppliedReplayResult(applied.stateDump, runtimeEvent, persistedRecord);
      }

      const failedRecord = this.replayRecord(runtimeEvent, 'pending', ['local'], {
        localApplicationState: 'failed',
        localDisplayError: this.localDisplayError(cause),
        insertionAnchor,
        ...(applied.registerEventHash ? { registerEventHash: applied.registerEventHash } : {}),
      });
      await this.stateStore.set(replayStoreId, failedRecord.replayKey, failedRecord);

      const result = this.emptyReplayAttemptResult(applied.stateDump);
      result.complete = false;
      result.pendingPublicEvents.push(failedRecord);
      result.ignoredPublicEvents.push({
        replayKey: failedRecord.replayKey,
        event: runtimeEvent,
        reason: 'register_failed',
        cause,
      });
      return result;
    }

    return this.localAppliedReplayResult(applied.stateDump, runtimeEvent, appliedRecord);
  }

  private localAppliedReplayResult(
    stateDump: StateDump,
    event: IndexedPublicEvent,
    record: ReconciledPublicEvent
  ): ReplayAttemptResult {
    const result = this.emptyReplayAttemptResult(stateDump);
    result.appliedEvents.push(event);
    result.appliedReplayKeys.push(record.replayKey);
    result.appliedPublicEvents.push({ replayKey: record.replayKey, event });
    result.pendingPublicEvents.push(record);
    return result;
  }

  async submitAnchors(onProgress?: LogProgress): Promise<string | undefined> {
    if (!this.anchoring) return undefined;
    return await new ProgressService(onProgress).step('anchor', () => this.eqty.submitAnchors());
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
      this.logger.warn('Error checking canConsume:', error);
      return false;
    }
  }

  private async withOwnableWrites<T>(ids: string[], operation: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(ids)].sort();
    const predecessors = sorted.map((id) => this.ownableWrites.get(id));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const id of sorted) this.ownableWrites.set(id, pending);
    await Promise.all(predecessors);
    try {
      // IndexedDB is shared across same-origin wallet tabs.
      const locks = typeof window === 'undefined' ? undefined : window.navigator.locks;
      let lockedOperation = operation;
      if (locks) {
        for (const id of [...sorted].reverse()) {
          const next = lockedOperation;
          lockedOperation = async () => await locks.request(`ownable-write:${id}`, next);
        }
      }
      return await lockedOperation();
    } finally {
      for (const id of sorted) {
        if (this.ownableWrites.get(id) === pending) this.ownableWrites.delete(id);
      }
      release();
    }
  }

  private async getAttachment(cid: string): Promise<Uint8Array | undefined> {
    const attached = await this.consumption?.getAttachment(cid);
    if (attached) return attached;
    if (!(await this.stateStore.hasStore(ATTACHMENT_STORE))) return undefined;
    return this.stateStore.get(ATTACHMENT_STORE, cid);
  }

  private async putAttachments(
    attachments: Map<string, Uint8Array>,
    mediaTypes?: ReadonlyMap<string, string>
  ): Promise<void> {
    if (this.consumption?.putAttachment) {
      for (const [cid, bytes] of attachments) {
        await this.consumption.putAttachment(cid, bytes, mediaTypes?.get(cid));
      }
      return;
    }
    if (!(await this.stateStore.hasStore(ATTACHMENT_STORE))) {
      await this.stateStore.createStore(ATTACHMENT_STORE);
    }
    await this.stateStore.setAll(ATTACHMENT_STORE, attachments);
  }

  private async storedChain(chain: EventChain): Promise<EventChain> {
    const stored = await this.stateStore.get(`ownable:${chain.id}`, 'chain');
    return stored ? EventChain.from(stored) : chain;
  }

  private priorConsume(
    consumer: EventChain,
    consumable: EventChain,
    submitted: EventChain
  ): Event | undefined {
    const terminal = consumable.events.at(-1);
    if (!terminal || terminal.parsedData.consume?.consumer_id !== consumer.id) return;
    if (
      submitted.latestHash.hex !== terminal.hash.hex &&
      submitted.latestHash.hex !== terminal.previous?.hex
    )
      return;
    return consumer.events.find(
      ({ parsedData }) =>
        isBoundIngest(parsedData) &&
        parsedData.source?.id === consumable.id &&
        parsedData.source.event === terminal.hash.hex
    );
  }

  private async anchorConsumption(
    consumer: EventChain,
    consumable: EventChain,
    ingest: Event,
    fresh: boolean,
    onProgress?: LogProgress
  ): Promise<void> {
    if (!this.anchoring) return;
    const storeId = `ownable:${consumer.id}`;
    const key = `consume-anchor:${ingest.hash.hex}`;
    if (!fresh && (await this.stateStore.get(storeId, key)) !== 'pending') return;

    if (!this.queuedConsumptionAnchors.has(key)) {
      const source = consumable.anchorMap.at(-1)!;
      const receiver = consumer.anchorMap.find(({ value }) => value.hex === ingest.hash.hex)!;
      const pairs = [source, receiver];
      if (pairs.some(({ signer }) => !sameAddress(signer, this.eqty.address))) {
        throw new Error('Consumption anchors must be submitted by the wallet that signed them');
      }
      let missing = pairs;
      if (!fresh) {
        const options = this.consumption;
        if (!options) throw new ConsumptionEvidencePendingError();
        const chains = [consumable, consumer];
        const evidence = await Promise.all(chains.map((chain) => options.verifyAnchors(chain)));
        missing = pairs.filter((pair, index) => {
          const record = evidence[index]?.details[pair.key.hex];
          if (!record?.transactionHash) return true;
          if (!record.verified || record.value.toLowerCase() !== pair.value.hex.toLowerCase()) {
            throw new Error('Consumption anchor conflicts with an authoritative anchor');
          }
          return false;
        });
      }
      if (missing.length) {
        await this.eqty.anchor(...missing);
        this.queuedConsumptionAnchors.add(key);
      }
    }
    if (this.queuedConsumptionAnchors.has(key)) {
      await this.submitAnchors(onProgress);
      this.queuedConsumptionAnchors.delete(key);
    }
    await this.stateStore.set(storeId, key, 'submitted');
  }

  async consume(
    consumer: EventChain,
    consumable: EventChain,
    onProgress?: LogProgress
  ): Promise<void> {
    if (consumer.id === consumable.id) throw new Error('An Ownable cannot consume itself');
    if (consumer.networkId !== consumable.networkId) {
      throw new Error('Both Ownables must belong to the same network');
    }
    await this.withOwnableWrites([consumer.id, consumable.id], async () => {
      const progress = new ProgressService(onProgress);
      const persistedConsumer = await this.storedChain(consumer);
      const persistedConsumable = await this.storedChain(consumable);
      const prior = this.priorConsume(persistedConsumer, persistedConsumable, consumable);
      if (prior) {
        consumer.add(persistedConsumer);
        consumable.add(persistedConsumable);
        await this.anchorConsumption(consumer, consumable, prior, false, onProgress);
        return;
      }

      const consumerHash = consumer.latestHash.hex;
      const consumableHash = consumable.latestHash.hex;
      if (
        consumerHash !== persistedConsumer.latestHash.hex ||
        consumableHash !== persistedConsumable.latestHash.hex
      ) {
        throw new Error('State mismatch for consume');
      }
      const [consumerState, consumableState] = await Promise.all([
        this.eventChains.getStateDump(consumer.id, consumer.state.hex),
        this.eventChains.getStateDump(consumable.id, consumable.state.hex),
      ]);
      if (!consumerState || !consumableState) throw new Error('State mismatch for consume');

      const info = { sender: this.eqty.address, funds: [] };
      const message = { consume: { consumer_id: consumer.id } };
      const sourceRpc = this.rpc(consumable.id);
      const result = await sourceRpc.execute(message, info, consumableState);
      const attributes = consumeAttributes(result.events, consumer.id);
      const { owner, issuer } = (await sourceRpc.query(
        { get_info: {} },
        result.state
      )) as TypedOwnableInfo;

      const source = EventChain.from(consumable.toJSON());
      const receiver = EventChain.from(consumer.toJSON());
      const signedConsume = new Event({ '@context': 'execute_msg.json', ...message }).addTo(source);
      await progress.step('signConsumableEvent', () => this.eqty.sign(signedConsume));
      if (!signedConsume.signerAddress || !sameAddress(signedConsume.signerAddress, info.sender)) {
        throw new Error('Consumable signing account changed during consumption');
      }

      const snapshot = await createConsumptionSnapshot(
        source,
        await this.packages.zip(this.consumePackageCid(source))
      );
      const claim: SignedConsumeIngestEvent = {
        type: 'consume',
        source: { id: source.id, owner, issuer, event: signedConsume.hash.hex, cid: snapshot.cid },
        target: { id: receiver.id },
        attributes,
      };
      const { state: receiverState } = await this.rpc(receiver.id).ingest(
        consumeRpcPayload(claim),
        info,
        consumerState
      );
      const signedIngest = new Event({ '@context': 'ingest_msg.json', ...claim }).addTo(receiver);
      await progress.step('signConsumerEvent', () => this.eqty.sign(signedIngest));
      if (!signedIngest.signerAddress || !sameAddress(signedIngest.signerAddress, info.sender)) {
        throw new Error('Consumer signing account changed during consumption');
      }

      const attachments = await collectOwnableAttachments(source, (cid) => this.getAttachment(cid));
      attachments.set(snapshot.cid, snapshot.bytes);
      await this.putAttachments(attachments);
      if (
        consumer.latestHash.hex !== consumerHash ||
        consumable.latestHash.hex !== consumableHash
      ) {
        throw new Error('State mismatch for consume');
      }
      const sourceStore = `ownable:${source.id}`;
      const receiverStore = `ownable:${receiver.id}`;
      await this.stateStore.setAll({
        [sourceStore]: {
          chain: source.toJSON(),
          latestHash: source.latestHash.hex,
          state: source.state.hex,
          isConsumed: true,
        },
        [`${sourceStore}.state`]: new Map(result.state),
        [receiverStore]: {
          chain: receiver.toJSON(),
          latestHash: receiver.latestHash.hex,
          state: receiver.state.hex,
          ...(this.anchoring ? { [`consume-anchor:${signedIngest.hash.hex}`]: 'pending' } : {}),
        },
        [`${receiverStore}.state`]: new Map(receiverState),
      });
      consumable.events = source.events;
      consumer.events = receiver.events;
      await this.anchorConsumption(receiver, source, signedIngest, true, onProgress);
    });
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

    throw new Error(`Operation failed after ${maxRetries} attempts. Last error: `);
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
      uniqueMessageHash: this.packages.info(pkg, uniqueMessageHash).uniqueMessageHash,
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
        this.logger.error('Failed to set data, cleaning up stores...');
        await Promise.all(
          stores.map((store) => this.stateStore.deleteStore(store).catch(() => {}))
        );
        throw error;
      }

      const verifyData = await Promise.all([
        this.stateStore.get(storeId, 'state'),
        stateDump ? this.stateStore.getAll(stateStoreId) : Promise.resolve(null),
      ]);

      if (verifyData[0] !== chainData.state || (stateDump && !verifyData[1]?.length)) {
        throw new Error('Data verification failed after write');
      }
    });
  }

  async store(chain: EventChain, stateDump: StateDump): Promise<void> {
    return this.withOwnableWrites([chain.id], () =>
      this.writeChain(chain, stateDump, this.anchoring)
    );
  }

  private async writeChain(
    chain: EventChain,
    stateDump: StateDump,
    anchor: boolean
  ): Promise<void> {
    const storeId = `ownable:${chain.id}`;
    const stateStoreId = `${storeId}.state`;

    await this.retryOperation(async () => {
      const storedState = await this.stateStore.get(storeId, 'state');
      if (storedState === chain.state || storedState === chain.state.hex) return;
      const previousHash = await this.stateStore.get(storeId, 'latestHash');
      const suffix =
        typeof previousHash === 'string'
          ? chain.startingAfter(Binary.fromHex(previousHash))
          : chain;

      const data = {
        [storeId]: {
          chain: chain.toJSON(),
          state: chain.state.hex,
          latestHash: chain.latestHash.hex,
        },
        [stateStoreId]: new Map(stateDump),
      };

      await this.stateStore.setAll(data);
      if (anchor && suffix.events.length) {
        // Queue anchors only; submission handled separately to allow batching.
        await this.eqty.anchor(...suffix.anchorMap);
      }

      const eventCount = chain.events.length;
      if (eventCount % this.SNAPSHOT_INTERVAL === 0) {
        await this.createSnapshot(chain, stateDump, eventCount - 1);
      }

      // Verify write
      const verifyState = await this.stateStore.get(storeId, 'state');
      if (verifyState !== chain.state.hex) {
        throw new Error('State verification failed after write');
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
    if (!firstEvent) throw new Error('Cannot zip an empty ownable chain');
    const packageCid: string = firstEvent.parsedData.package;

    const zip = await this.packages.zip(packageCid);
    const attachments = await collectOwnableAttachments(chain, (cid) => this.getAttachment(cid));
    for (const [cid, bytes] of attachments) zip.file(`${OWNABLE_ATTACHMENT_PREFIX}${cid}`, bytes);
    zip.file('chain.json', JSON.stringify(serializeOwnableChain(chain)));

    return zip;
  }
}
