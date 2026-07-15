import { withProgress } from "@ownables/core";
import type { LogProgress } from "@ownables/core";
import type {
  IndexedPublicEventsSnapshot,
  IndexedPublicEventsStreamHandlers,
  IndexedPublicEventsStreamSubscription,
  IndexedPublicEventsStreamEvent,
} from "@ownables/core";
import JSZip from "jszip";

export interface HubUploadResult {
  cid: string;
  owner?: string;
  ownerAccount?: string;
  nftNetwork?: string;
  smartContractAddress?: string;
  NftId?: string;
}

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

import { AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE } from "../constants/hub.js";

export default class HubService {
  constructor(
    private readonly url: string = "",
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (input, init) =>
      fetch(input, init),
    private readonly eventSourceFactory: (url: string) => HubEventSourceLike = (url) => {
      const EventSourceCtor = (globalThis as { EventSource?: new (input: string) => HubEventSourceLike }).EventSource;
      if (!EventSourceCtor) {
        throw new Error("EventSource is not available in this environment");
      }
      return new EventSourceCtor(url);
    }
  ) {}

  get isConfigured(): boolean {
    return this.url.trim().length > 0;
  }

  get origin(): string {
    if (!this.isConfigured) {
      throw new Error("VITE_HUB is not configured");
    }

    return new URL(this.url).origin;
  }

  private endpoint(path: string): string {
    if (!this.isConfigured) {
      throw new Error("VITE_HUB is not configured");
    }

    return `${this.url.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  parseHubDownloadUrl(url: string): URL {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Hub download URL is malformed");
    }

    if (parsed.origin !== this.origin) {
      throw new Error("Hub download URL must use the configured Hub origin");
    }

    return parsed;
  }

  getOwnableBundleUrl(id: string): string {
    return this.endpoint(`/ownables/${encodeURIComponent(id)}/bundle`);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured) return false;

    try {
      const response = await this.fetchFn(this.endpoint("/health"), { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  async uploadOwnable(
    content: Uint8Array,
    filename = "ownable.zip",
    onProgress?: LogProgress
  ): Promise<HubUploadResult> {
    const step = withProgress(onProgress);

    return await step("hubUpload", async () => {
      const form = new FormData();
      const buffer = new ArrayBuffer(content.byteLength);
      new Uint8Array(buffer).set(content);
      form.append("file", new File([buffer], filename, { type: "application/zip" }));

      const response = await this.fetchFn(this.endpoint("/ownables/upload"), {
        method: "POST",
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
    const step = withProgress(onProgress);

    return await step("hubDownload", async () => {
      const bundleUrl = this.parseHubDownloadUrl(this.getOwnableBundleUrl(ownableId));
      const response = await this.fetchFn(bundleUrl.toString());

      if (!response.ok) {
        const message = await readError(response);
        throw new Error(`Hub download failed: ${message}`);
      }

      return new File([await response.blob()], fileNameFromUrl(bundleUrl), {
        type: response.headers.get("content-type") || "application/zip",
      });
    });
  }

  async importFromHub(packageCid: string, ownableId: string): Promise<{
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
      packageFile: new File([bundleBlob], packageCid ? `${packageCid}.zip` : fileNameFromUrl(bundleUrl), {
        type: bundleResponse.headers.get("content-type") || "application/zip",
      }),
      chainJson,
    };
  }

  async loadOwnablePublicEvents(ownableId: string): Promise<IndexedPublicEventsSnapshot> {
    const response = await this.fetchFn(
      this.endpoint(`/ownables/${encodeURIComponent(ownableId)}/public-events`)
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
    const query = new URLSearchParams();
    for (const ownableId of ownableIds) {
      query.append("id", ownableId);
    }
    if (options?.fromBlock !== undefined) {
      query.set("from", String(options.fromBlock));
    }

    const stream = this.eventSourceFactory(
      this.endpoint(`/ownables/public-events/stream?${query.toString()}`)
    );
    const listener = (event: { data?: string }) => {
      handlers.onEvent(parseJsonMessage<IndexedPublicEventsStreamEvent>(event.data));
    };

    stream.addEventListener("public-event", listener);
    stream.onerror = (error) => handlers.onError?.(error);

    return {
      close: () => {
        stream.removeEventListener("public-event", listener);
        stream.close();
      },
    };
  }

  watchAvailableOwnables(
    ownerAccount: string,
    handlers: HubAvailableOwnablesStreamHandlers
  ): IndexedPublicEventsStreamSubscription {
    const query = new URLSearchParams({
      owner: ownerAccount,
    });
    const stream = this.eventSourceFactory(
      this.endpoint(`/ownables/available/stream?${query.toString()}`)
    );
    const listener = (event: { data?: string }) => {
      handlers.onEvent(parseJsonMessage<{ owner: string; entry: HubAvailableOwnableEntry }>(event.data));
    };

    stream.addEventListener("available-ownable", listener);
    stream.onerror = (error) => handlers.onError?.(error);

    return {
      close: () => {
        stream.removeEventListener("available-ownable", listener);
        stream.close();
      },
    };
  }

  async listAvailableOwnables(
    ownerAccount: string
  ): Promise<HubAvailableOwnablesResponse> {
    const query = new URLSearchParams({
      owner: ownerAccount,
    });

    try {
      const response = await this.fetchFn(
        this.endpoint(`/ownables/available?${query.toString()}`)
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
        error.message.startsWith("Hub available-ownables lookup failed:")
      ) {
        throw error;
      }

      if (
        error instanceof Error &&
        error.message === AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE
      ) {
        throw error;
      }

      throw new Error(AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE);
    }
  }
}

function fileNameFromUrl(url: URL): string {
  const lastSegment = url.pathname.split("/").filter(Boolean).pop();
  if (!lastSegment) return "ownable.zip";
  return lastSegment.endsWith(".zip") ? lastSegment : `${lastSegment}.zip`;
}

async function readError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined);
    if (body?.message) return String(body.message);
    if (body?.error) return String(body.error);
    if (body?.code) return String(body.code);
    if (body) return JSON.stringify(body);
  }

  return (await response.text().catch(() => "")) || `${response.status} ${response.statusText}`;
}

async function readChainJsonFromBundle(bundleBlob: Blob): Promise<unknown> {
  const archive = await JSZip.loadAsync(await bundleBlob.arrayBuffer());
  const chainEntry = archive.file("chain.json") ?? archive.file("eventChain.json");

  if (!chainEntry) {
    throw new Error("Hub bundle did not include chain.json");
  }

  return JSON.parse(await chainEntry.async("text"));
}

function parseJsonMessage<T>(payload: string | undefined): T {
  if (!payload) {
    throw new Error("Hub stream message did not include a JSON payload");
  }

  return JSON.parse(payload) as T;
}
