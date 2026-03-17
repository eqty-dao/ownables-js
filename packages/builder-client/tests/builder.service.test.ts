import { describe, expect, it, vi } from 'vitest';

import BuilderService from '../src/services/Builder.service';

describe('BuilderService', () => {
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

    const service = new BuilderService(84532, {
      url: 'https://builder.test',
      httpClient,
    });

    const address = await service.getAddress();
    expect(address).toBe('T-address');
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('throws when URL is missing for template cost', async () => {
    const service = new BuilderService(84532, { url: '' });
    await expect(service.getTemplateCost(1)).rejects.toThrow('Builder service URL not configured');
  });
});
