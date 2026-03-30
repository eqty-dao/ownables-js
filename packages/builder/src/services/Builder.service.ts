import type {
  BuildInstantiateMsgInput,
  BuilderDeployAdapter,
  CostEstimate,
  DeployParams,
  DeployResult,
  EstimateCostInput,
  InstantiateMsgPayload,
  PreparedOwnable,
  PrepareOwnableInput,
} from "../types/Builder";
import { FIXED_OWNABLE_TYPE } from "../types/Builder";

const normalize = (value: string, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
};

export const prepareOwnable = async (
  input: PrepareOwnableInput
): Promise<PreparedOwnable> => {
  if (input.files.length === 0) {
    throw new Error("At least one asset file is required");
  }

  const name = normalize(input.name, "name");
  const description = normalize(input.description, "description");

  const pkg = await input.packageService.processPackage(input.files);
  if (!pkg) {
    throw new Error("Failed to process ownable package");
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
};

export const buildInstantiateMsg = (
  input: BuildInstantiateMsgInput
): InstantiateMsgPayload => {
  return {
    name: normalize(input.name, "name"),
    description: normalize(input.description, "description"),
    package: input.packageCid,
    network_id: input.networkId,
    ownable_type: FIXED_OWNABLE_TYPE,
    keywords: input.keywords ?? [],
    ...(input.nft !== undefined ? { nft: input.nft } : {}),
  };
};

export const deploy = async (
  adapter: BuilderDeployAdapter,
  params: DeployParams
): Promise<DeployResult> => {
  const result = await adapter.deployContract({
    wasm: params.wasm,
    instantiateMsg: params.instantiateMsg,
  });

  if (
    params.expectedCodeHash &&
    adapter.getCodeHash &&
    result.contractAddress
  ) {
    const actualCodeHash = (await adapter.getCodeHash(result.contractAddress)).toLowerCase();
    const expectedCodeHash = params.expectedCodeHash.toLowerCase();

    if (actualCodeHash !== expectedCodeHash) {
      throw new Error(
        `Code hash mismatch: expected ${expectedCodeHash}, got ${actualCodeHash}`
      );
    }

    return {
      ...result,
      codeHash: actualCodeHash,
    };
  }

  return result;
};

export const estimateCost = (input: EstimateCostInput = {}): CostEstimate => {
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
};
