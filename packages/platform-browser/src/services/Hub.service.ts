import { ProgressService } from '@ownables/core';
import type { LogProgress } from '@ownables/core';
import type {
  IndexedPublicEventsSnapshot,
  IndexedPublicEventsStreamHandlers,
  IndexedPublicEventsStreamSubscription,
  IndexedPublicEventsStreamEvent,
} from '@ownables/core';
import JSZip from 'jszip';

export interface HubAvailableUploadResult {
  status: 'available';
  ownableId: string;
  cid: string;
  owner?: string;
  ownerAccount?: string;
}

export interface HubPendingUploadResult {
  status: 'pending';
  ownableId: string;
  expiresAt: string;
}

export type HubUploadResult = HubAvailableUploadResult | HubPendingUploadResult;

export interface HubAvailableOwnableEntry {
  id: string;
  title: string;
  description?: string;
  issuer?: string;
  availableAt: string;
  package: {
    cid: string;
    thumbnailUrl?: string | null;
  };
}

export interface HubAvailableOwnablesResponse {
  owner: string;
  entries: HubAvailableOwnableEntry[];
}

export interface HubEventSourceLike {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  removeEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
  onerror: ((event: unknown) => void) | null;
}

export interface HubAvailableOwnablesStreamHandlers {
  onEvent(message: { owner: string; entry: HubAvailableOwnableEntry }): void;
  onError?: (error: unknown) => void;
}

import { AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE } from '../constants/hub.js';

export type HubNetwork = 'base' | 'base-sepolia';

export function hubNetworkFromChainId(chainId: number | string): HubNetwork {
  const normalizedChainId = normalizeChainId(chainId);

  if (normalizedChainId === 8453) return 'base';
  if (normalizedChainId === 84532) return 'base-sepolia';

  throw new Error(`Unsupported Hub chain ID: ${normalizedChainId}`);
}

export default class HubService {
  private readonly network: HubNetwork;

  constructor(
    private readonly url: string,
    network: HubNetwork,
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (
      input,
      init
    ) => fetch(input, init),
    private readonly eventSourceFactory: (url: string) => HubEventSourceLike = (url) => {
      const EventSourceCtor = (
        globalThis as { EventSource?: new (input: string) => HubEventSourceLike }
      ).EventSource;
      if (!EventSourceCtor) {
        throw new Error('EventSource is not available in this environment');
      }
      return new EventSourceCtor(url);
    }
  ) {
    this.network = normalizeHubNetwork(network);
  }

  get isConfigured(): boolean {
    return this.url.trim().length > 0;
  }

  get origin(): string {
    if (!this.isConfigured) {
      throw new Error('VITE_HUB is not configured');
    }

    return new URL(this.url).origin;
  }

  private endpoint(path: string): string {
    if (!this.isConfigured) {
      throw new Error('VITE_HUB is not configured');
    }

    return `${this.url.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  private networkEndpoint(path: string): string {
    return this.endpoint(`/${this.network}/${path.replace(/^\//, '')}`);
  }

  parseHubDownloadUrl(url: string): URL {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Hub download URL is malformed');
    }

    if (parsed.origin !== this.origin) {
      throw new Error('Hub download URL must use the configured Hub origin');
    }

    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const [network, resource] = pathSegments;
    if (
      (network === 'base' || network === 'base-sepolia') &&
      network !== this.network &&
      resource === 'ownables'
    ) {
      throw new Error('Hub download URL must use the configured Hub network');
    }

    return parsed;
  }

  getOwnableBundleUrl(id: string): string {
    return this.networkEndpoint(`/ownables/${encodeURIComponent(id)}/bundle`);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const response = await this.fetchFn(this.endpoint('/health'), { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async uploadOwnable(
    content: Uint8Array,
    filename = 'ownable.zip',
    onProgress?: LogProgress
  ): Promise<HubUploadResult> {
    const progress = new ProgressService(onProgress);

    return await progress.step('hubUpload', async () => {
      const form = new FormData();
      if (!(content.buffer instanceof ArrayBuffer)) {
        throw new TypeError('Hub uploads require an ArrayBuffer-backed Uint8Array');
      }
      const fileContent = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      form.append('file', new File([fileContent], filename, { type: 'application/zip' }));

      const response = await this.fetchFn(this.networkEndpoint('/ownables'), {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const message = await readError(response);
        throw new Error(`Hub upload failed: ${message}`);
      }

      return (await response.json()) as HubUploadResult;
    });
  }

  async downloadOwnable(ownableId: string, onProgress?: LogProgress): Promise<File> {
    const progress = new ProgressService(onProgress);

    return await progress.step('hubDownload', async () => {
      const bundleUrl = this.parseHubDownloadUrl(this.getOwnableBundleUrl(ownableId));
      const response = await this.fetchFn(bundleUrl.toString());

      if (!response.ok) {
        const message = await readError(response);
        throw new Error(`Hub download failed: ${message}`);
      }

      return new File([await response.blob()], fileNameFromUrl(bundleUrl), {
        type: response.headers.get('content-type') || 'application/zip',
      });
    });
  }

  async importFromHub(
    packageCid: string,
    ownableId: string
  ): Promise<{
    packageFile: File;
    chainJson: unknown;
  }> {
    const bundleUrl = this.parseHubDownloadUrl(this.getOwnableBundleUrl(ownableId));
    const bundleResponse = await this.fetchFn(bundleUrl.toString());

    if (!bundleResponse.ok) {
      const message = await readError(bundleResponse);
      throw new Error(`Hub import failed: ${message}`);
    }

    const bundleBlob = await bundleResponse.blob();
    const chainJson = await readChainJsonFromBundle(bundleBlob);

    return {
      packageFile: new File(
        [bundleBlob],
        packageCid ? `${packageCid}.zip` : fileNameFromUrl(bundleUrl),
        {
          type: bundleResponse.headers.get('content-type') || 'application/zip',
        }
      ),
      chainJson,
    };
  }

  async loadOwnablePublicEvents(ownableId: string): Promise<IndexedPublicEventsSnapshot> {
    const response = await this.fetchFn(
      this.networkEndpoint(`/ownables/${encodeURIComponent(ownableId)}/public-events`)
    );

    if (!response.ok) {
      const message = await readError(response);
      throw new Error(`Hub public-events snapshot failed: ${message}`);
    }

    return (await response.json()) as IndexedPublicEventsSnapshot;
  }

  watchOwnablePublicEvents(
    ownableIds: string[],
    handlers: IndexedPublicEventsStreamHandlers,
    options?: { fromBlock?: string | number | bigint }
  ): IndexedPublicEventsStreamSubscription {
    if (ownableIds.length === 0) {
      throw new Error('At least one ownable ID is required to watch public events');
    }

    const query = new URLSearchParams();
    for (const ownableId of ownableIds) {
      query.append('ownableId', ownableId);
    }
    if (options?.fromBlock !== undefined) {
      query.set('fromBlock', String(options.fromBlock));
    }

    const stream = this.eventSourceFactory(
      this.networkEndpoint(`/streams/public-events?${query.toString()}`)
    );
    const listener = (event: { data?: string }) => {
      handlers.onEvent(parseJsonMessage<IndexedPublicEventsStreamEvent>(event.data));
    };

    stream.addEventListener('public-event', listener);
    stream.onerror = (error) => handlers.onError?.(error);

    return {
      close: () => {
        stream.removeEventListener('public-event', listener);
        stream.close();
      },
    };
  }

  watchAvailableOwnables(
    address: string,
    handlers: HubAvailableOwnablesStreamHandlers
  ): IndexedPublicEventsStreamSubscription {
    validateInboxAddress(address);
    const stream = this.eventSourceFactory(
      this.networkEndpoint(`/streams/inbox/${encodeURIComponent(address)}`)
    );
    const listener = (event: { data?: string }) => {
      handlers.onEvent(
        parseJsonMessage<{ owner: string; entry: HubAvailableOwnableEntry }>(event.data)
      );
    };

    stream.addEventListener('available-ownable', listener);
    stream.onerror = (error) => handlers.onError?.(error);

    return {
      close: () => {
        stream.removeEventListener('available-ownable', listener);
        stream.close();
      },
    };
  }

  async listAvailableOwnables(address: string): Promise<HubAvailableOwnablesResponse> {
    validateInboxAddress(address);

    try {
      const response = await this.fetchFn(
        this.networkEndpoint(`/inbox/${encodeURIComponent(address)}`)
      );

      if (response.status === 404 || response.status === 501) {
        throw new Error(AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE);
      }

      if (!response.ok) {
        const message = await readError(response);
        throw new Error(`Hub available-ownables lookup failed: ${message}`);
      }

      return (await response.json()) as HubAvailableOwnablesResponse;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Hub available-ownables lookup failed:')
      ) {
        throw error;
      }

      if (error instanceof Error && error.message === AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE) {
        throw error;
      }

      throw new Error(AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE);
    }
  }
}

function normalizeChainId(chainId: number | string): number {
  if (typeof chainId === 'number') {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error('Hub chain ID must be a positive safe integer');
    }
    return chainId;
  }

  if (!/^[1-9]\d*$/.test(chainId)) {
    throw new Error('Hub chain ID must be a positive decimal value');
  }

  const normalizedChainId = Number(chainId);
  if (!Number.isSafeInteger(normalizedChainId)) {
    throw new Error('Hub chain ID must be a positive safe integer');
  }

  return normalizedChainId;
}

function normalizeHubNetwork(network: HubNetwork): HubNetwork {
  if (network === 'base' || network === 'base-sepolia') {
    return network;
  }

  throw new Error(`Unsupported Hub network: ${String(network)}`);
}

function validateInboxAddress(address: string): void {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) {
    throw new Error('Inbox address must be a valid EVM address');
  }
}

function fileNameFromUrl(url: URL): string {
  const lastSegment = url.pathname.split('/').filter(Boolean).pop();
  if (!lastSegment) return 'ownable.zip';
  return lastSegment.endsWith('.zip') ? lastSegment : `${lastSegment}.zip`;
}

async function readError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => undefined);
    if (body?.message) return String(body.message);
    if (body?.error) return String(body.error);
    if (body?.code) return String(body.code);
    if (body) return JSON.stringify(body);
  }

  return (await response.text().catch(() => '')) || `${response.status} ${response.statusText}`;
}

async function readChainJsonFromBundle(bundleBlob: Blob): Promise<unknown> {
  const archive = await JSZip.loadAsync(await bundleBlob.arrayBuffer());
  const chainEntry = archive.file('chain.json') ?? archive.file('eventChain.json');

  if (!chainEntry) {
    throw new Error('Hub bundle did not include chain.json');
  }

  return JSON.parse(await chainEntry.async('text'));
}

function parseJsonMessage<T>(payload: string | undefined): T {
  if (!payload) {
    throw new Error('Hub stream message did not include a JSON payload');
  }

  return JSON.parse(payload) as T;
}
