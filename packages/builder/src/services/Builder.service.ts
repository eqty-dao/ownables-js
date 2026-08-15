import type {
  BuildInstantiateMsgInput,
  BuilderDeployAdapter,
  CostEstimate,
  DeployParams,
  DeployResult,
  EstimateCostInput,
  InstantiateMsgPayload,
  OwnableMetadataInput,
  PrepareDossierInput,
  PreparedOwnable,
  PrepareOwnableInput,
  BuilderServiceOptions,
} from '../types/Builder';
import { FIXED_OWNABLE_TYPE } from '../types/Builder';

const normalize = (value: string, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
};

const withPreparedMetadata = (
  pkg: PreparedOwnable['pkg'],
  input: OwnableMetadataInput
): PreparedOwnable['pkg'] => ({
  ...pkg,
  title: input.name,
  description: input.description,
  ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
});

const withOptionalThumbnail = (files: File[], thumbnail?: File): File[] => {
  if (!thumbnail) {
    return files;
  }

  const stagedThumbnail = new File([thumbnail], 'thumbnail.webp', {
    type: thumbnail.type || 'image/webp',
    lastModified: thumbnail.lastModified,
  });

  return [...files.filter((file) => file.name !== stagedThumbnail.name), stagedThumbnail];
};

const DOSSIER_BUNDLE_URL = new URL('../dossier.zip', import.meta.url).toString();

export class BuilderService {
  private readonly fetchFn: NonNullable<BuilderServiceOptions['fetchFn']>;
  private readonly bundleUrl: string;

  constructor(private readonly options: BuilderServiceOptions) {
    this.fetchFn =
      options.fetchFn ?? ((resource: string, init?: RequestInit) => fetch(resource, init));
    this.bundleUrl = options.bundleUrl ?? DOSSIER_BUNDLE_URL;
  }

  async prepareOwnable(input: PrepareOwnableInput): Promise<PreparedOwnable> {
    const name = normalize(input.name, 'name');
    const description = normalize(input.description, 'description');

    const pkg = await this.options.packageService.processPackage(input.files);
    if (!pkg) {
      throw new Error('Failed to process ownable package');
    }

    return {
      packageCid: pkg.cid,
      pkg: {
        ...pkg,
        title: pkg.title || name,
        description: pkg.description || description,
        ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
      },
    };
  }

  async prepareDossier(input: PrepareDossierInput): Promise<PreparedOwnable> {
    const name = normalize(input.name, 'name');
    const description = normalize(input.description, 'description');
    const response = await this.fetchFn(this.bundleUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to load bundled dossier package: ${response.status} ${response.statusText}`
      );
    }

    const zipFile = new File([await response.blob()], 'dossier.zip', {
      type: 'application/zip',
    });
    const files = withOptionalThumbnail(
      await this.options.packageService.extractAssets(zipFile),
      input.thumbnail
    );

    const prepared = await this.prepareOwnable({
      name,
      description,
      files,
      ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
    });

    return {
      ...prepared,
      pkg: withPreparedMetadata(prepared.pkg, {
        name,
        description,
        ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
      }),
    };
  }

  buildInstantiateMsg(input: BuildInstantiateMsgInput): InstantiateMsgPayload {
    return {
      name: normalize(input.name, 'name'),
      description: normalize(input.description, 'description'),
      package: input.packageCid,
      network_id: input.networkId,
      ownable_type: FIXED_OWNABLE_TYPE,
      keywords: input.keywords ?? [],
      ...(input.nft !== undefined ? { nft: input.nft } : {}),
    };
  }

  async deploy(params: DeployParams): Promise<DeployResult> {
    const adapter = this.options.deployAdapter;
    if (!adapter) throw new Error('BuilderService deploy adapter is not configured');
    const result = await adapter.deployContract({
      wasm: params.wasm,
      instantiateMsg: params.instantiateMsg,
    });

    if (params.expectedCodeHash && adapter.getCodeHash && result.contractAddress) {
      const actualCodeHash = (await adapter.getCodeHash(result.contractAddress)).toLowerCase();
      const expectedCodeHash = params.expectedCodeHash.toLowerCase();

      if (actualCodeHash !== expectedCodeHash) {
        throw new Error(`Code hash mismatch: expected ${expectedCodeHash}, got ${actualCodeHash}`);
      }

      return {
        ...result,
        codeHash: actualCodeHash,
      };
    }

    return result;
  }

  estimateCost(input: EstimateCostInput = {}): CostEstimate {
    if (input.fallbackEth) {
      return {
        eth: input.fallbackEth,
      };
    }

    const gasUnits = input.gasUnits ?? 300000n;
    const gasPriceGwei = input.gasPriceGwei ?? 0.1;
    const nativePriceUsd = input.nativePriceUsd;

    const gasPriceWei = BigInt(Math.round(gasPriceGwei * 1_000_000_000));
    const totalWei = gasUnits * gasPriceWei;
    const eth = Number(totalWei) / 1_000_000_000_000_000_000;

    const estimate: CostEstimate = {
      eth: eth.toFixed(6),
    };

    if (nativePriceUsd !== undefined) {
      estimate.usd = (eth * nativePriceUsd).toFixed(2);
    }

    return estimate;
  }
}
