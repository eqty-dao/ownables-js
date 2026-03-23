import { describe, expect, it, vi } from 'vitest';

import BuilderService from '../src/services/Builder.service';

describe('BuilderService', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createService = (chainId: number, options: any = {}) =>
    new BuilderService(chainId, { ...options, logger: options.logger ?? logger });

  it('returns address using injected http client', async () => {
    const httpClient = {
      get: vi.fn().mockResolvedValue({
        data: {
          serverLtoWalletAddress_L: 'L-address',
          serverLtoWalletAddress_T: 'T-address',
        },
      }),
      post: vi.fn(),
    };

    const service = createService(84532, {
      url: 'https://builder.test',
      httpClient,
    });

    const address = await service.getAddress();
    expect(address).toBe('T-address');
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('throws when URL is missing for template cost', async () => {
    const service = createService(84532, { url: '' });
    await expect(service.getTemplateCost(1)).rejects.toThrow('Builder service URL not configured');
  });

  it('returns null address when service is unavailable or request fails', async () => {
    const unavailable = createService(84532, { url: '' });
    await expect(unavailable.getAddress()).resolves.toBeNull();

    const failing = createService(84532, {
      url: 'https://builder.test',
      httpClient: {
        get: vi.fn().mockRejectedValue(new Error('boom')),
        post: vi.fn(),
      },
    });
    await expect(failing.getAddress()).resolves.toBeNull();
  });

  it('maps chain id to network id with default fallback', () => {
    expect(createService(8453, { url: 'x' }).getLtoNetworkId()).toBe('L');
    expect(createService(84532, { url: 'x' }).getLtoNetworkId()).toBe('T');
    expect(createService(1, { url: 'x' }).getLtoNetworkId()).toBe('T');
  });

  it('returns template cost and bubbles API errors', async () => {
    const service = createService(84532, {
      url: 'https://builder.test',
      secret: 'secret',
      httpClient: {
        get: vi.fn().mockResolvedValue({
          data: {
            T: { base: { ETH: '0.01', USD: '20' } },
          },
        }),
        post: vi.fn(),
      },
    });

    await expect(service.getTemplateCost(1)).resolves.toEqual({ eth: '0.01', usd: '20' });

    const failing = createService(84532, {
      url: 'https://builder.test',
      httpClient: {
        get: vi.fn().mockRejectedValue({ response: { data: { error: 'bad' } } }),
        post: vi.fn(),
      },
    });
    await expect(failing.getTemplateCost(1)).rejects.toThrow('bad');
  });

  it('uploads zip and maps request id from different shapes', async () => {
    const formData = { append: vi.fn() } as any;
    const httpClient = {
      get: vi.fn(),
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: { requestId: 'req-1', message: 'queued' } })
        .mockResolvedValueOnce({ data: { requestId: { requestId: 'req-2' } } }),
    };
    const service = createService(84532, {
      url: 'https://builder.test',
      httpClient,
      formDataFactory: () => formData,
    });

    await expect(service.upload(new Uint8Array([1, 2, 3]))).resolves.toEqual({
      requestId: 'req-1',
      message: 'queued',
    });
    await expect(service.upload(new Blob(['a']))).resolves.toEqual({
      requestId: 'req-2',
      message: 'Request queued',
    });
    expect(formData.append).toHaveBeenCalled();
  });
});
