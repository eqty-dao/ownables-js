import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import HubService, {
  AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE,
  type HubEventSourceLike,
} from '../src/services/Hub.service';

describe('HubService', () => {
  const ACCOUNT = '0xabc';
  const createEventSource = (url: string) => {
    const listeners = new Map<string, Array<(event: { data?: string }) => void>>();
    const stream: HubEventSourceLike & {
      url: string;
      emit(type: string, payload: unknown): void;
      closed: boolean;
    } = {
      url,
      closed: false,
      onerror: null,
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type, listener) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((candidate) => candidate !== listener)
        );
      },
      close() {
        stream.closed = true;
      },
      emit(type, payload) {
        for (const listener of listeners.get(type) ?? []) {
          listener({ data: JSON.stringify(payload) });
        }
      },
    };
    return stream;
  };

  it('uses the ownables-scoped discovery route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ owner: ACCOUNT, entries: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const hub = new HubService('https://hub.example', fetchFn);

    await hub.listAvailableOwnables(ACCOUNT);

    expect(fetchFn).toHaveBeenCalledWith(
      `https://hub.example/ownables/available?owner=${encodeURIComponent(ACCOUNT)}`
    );
  });

  it('loads indexed public-event snapshots from the dedicated per-ownable route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ownableId: 'ownable-1',
          publicEvents: [{ transactionHash: '0x1', logIndex: 0 }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    const hub = new HubService('https://hub.example', fetchFn);

    await expect(hub.loadOwnablePublicEvents('ownable-1')).resolves.toEqual({
      ownableId: 'ownable-1',
      publicEvents: [{ transactionHash: '0x1', logIndex: 0 }],
    });
    expect(fetchFn).toHaveBeenCalledWith('https://hub.example/ownables/ownable-1/public-events');
  });

  it('guards Hub imports to the configured origin', () => {
    const hub = new HubService('https://hub.example');

    expect(() => hub.parseHubDownloadUrl(hub.getOwnableBundleUrl('ownable-1'))).not.toThrow();
    expect(() => hub.parseHubDownloadUrl('https://evil.example/ownables/bafy/download')).toThrow(
      'Hub download URL must use the configured Hub origin'
    );
    expect(() => hub.parseHubDownloadUrl('not-a-url')).toThrow('Hub download URL is malformed');
  });

  it('maps missing discovery endpoints to the accepted unavailable message', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));
    const hub = new HubService('https://hub.example', fetchFn);

    await expect(hub.listAvailableOwnables(ACCOUNT)).rejects.toThrow(
      AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE
    );
  });

  it('probes hub availability through the health endpoint', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'));

    const hub = new HubService('https://hub.example', fetchFn);

    await expect(hub.isAvailable()).resolves.toBe(true);
    await expect(hub.isAvailable()).resolves.toBe(false);
    expect(fetchFn).toHaveBeenNthCalledWith(1, 'https://hub.example/health', { method: 'GET' });
    expect(fetchFn).toHaveBeenNthCalledWith(2, 'https://hub.example/health', { method: 'GET' });
  });

  it('uploads ownables to the Hub upload endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ cid: 'bafy-uploaded', owner: ACCOUNT }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const hub = new HubService('https://hub.example', fetchFn);

    const result = await hub.uploadOwnable(new Uint8Array([1, 2, 3]), 'dossier.zip');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://hub.example/ownables/upload');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);

    const uploadedFile = (fetchFn.mock.calls[0]?.[1]?.body as FormData).get('file');
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).name).toBe('dossier.zip');
    expect(result).toEqual({ cid: 'bafy-uploaded', owner: ACCOUNT });
  });

  it('downloads ownables from the Hub bundle endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(new Blob(['zip-bytes'], { type: 'application/zip' }), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      })
    );
    const hub = new HubService('https://hub.example', fetchFn);

    const result = await hub.downloadOwnable('ownable-download');

    expect(fetchFn).toHaveBeenCalledWith('https://hub.example/ownables/ownable-download/bundle');
    expect(result.name).toBe('bundle.zip');
    expect(result.type).toBe('application/zip');
  });

  it('fails import when the Hub bundle does not include chain state', async () => {
    const archive = await new Blob(
      [await createBundle([['package.json', JSON.stringify({ name: 'bundle' })]])],
      { type: 'application/zip' }
    );
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(archive, {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      })
    );
    const hub = new HubService('https://hub.example', fetchFn);

    await expect(hub.importFromHub('bafy-1', 'ownable-1')).rejects.toThrow(
      'Hub bundle did not include chain.json'
    );
  });

  it('imports package and chain payloads from Hub', async () => {
    const archive = await new Blob(
      [
        await createBundle([
          ['chain.json', JSON.stringify({ id: 'ownable-1' })],
          ['package.json', JSON.stringify({ name: 'bundle' })],
        ]),
      ],
      { type: 'application/zip' }
    );
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(archive, {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      })
    );
    const hub = new HubService('https://hub.example', fetchFn);

    const result = await hub.importFromHub('bafy-1', 'ownable-1');

    expect(fetchFn).toHaveBeenNthCalledWith(1, 'https://hub.example/ownables/ownable-1/bundle');
    expect(result.packageFile.name).toBe('bafy-1.zip');
    expect(result.chainJson).toEqual({ id: 'ownable-1' });
  });

  it('opens a dedicated public-events stream with repeated id params and from=<block>', () => {
    const streams: ReturnType<typeof createEventSource>[] = [];
    const hub = new HubService('https://hub.example', vi.fn(), (url) => {
      const stream = createEventSource(url);
      streams.push(stream);
      return stream;
    });
    const onEvent = vi.fn();
    const onError = vi.fn();

    const subscription = hub.watchOwnablePublicEvents(
      ['ownable-1', 'ownable-2'],
      { onEvent, onError },
      { fromBlock: 11 }
    );

    expect(streams[0]?.url).toBe(
      'https://hub.example/ownables/public-events/stream?id=ownable-1&id=ownable-2&from=11'
    );

    streams[0]?.emit('public-event', {
      ownableId: 'ownable-1',
      publicEvent: { transactionHash: '0x1', logIndex: 0 },
    });
    streams[0]!.onerror?.(new Error('offline'));
    subscription.close();

    expect(onEvent).toHaveBeenCalledWith({
      ownableId: 'ownable-1',
      publicEvent: { transactionHash: '0x1', logIndex: 0 },
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(streams[0]?.closed).toBe(true);
  });

  it('keeps discovery streaming separate from indexed public-events transport', () => {
    const streams: ReturnType<typeof createEventSource>[] = [];
    const hub = new HubService('https://hub.example', vi.fn(), (url) => {
      const stream = createEventSource(url);
      streams.push(stream);
      return stream;
    });
    const onDiscovery = vi.fn();

    hub.watchAvailableOwnables('eip155:84532:0xabc', { onEvent: onDiscovery });

    expect(streams[0]?.url).toBe(
      'https://hub.example/ownables/available/stream?owner=eip155%3A84532%3A0xabc'
    );

    streams[0]?.emit('available-ownable', {
      owner: 'eip155:84532:0xabc',
      entry: {
        id: 'ownable-1',
        title: 'Ownable 1',
        availableAt: '2026-07-09T00:00:00.000Z',
        package: { cid: 'bafy' },
      },
    });

    expect(onDiscovery).toHaveBeenCalledWith({
      owner: 'eip155:84532:0xabc',
      entry: {
        id: 'ownable-1',
        title: 'Ownable 1',
        availableAt: '2026-07-09T00:00:00.000Z',
        package: { cid: 'bafy' },
      },
    });
  });
});

async function createBundle(entries: Array<[string, string]>): Promise<Uint8Array> {
  const archive = new JSZip();
  for (const [name, content] of entries) {
    archive.file(name, content);
  }
  return archive.generateAsync({ type: 'uint8array' });
}
