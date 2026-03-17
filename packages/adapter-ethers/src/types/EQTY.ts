import type { Binary } from 'eqty-core';
import type { Provider, Signer, TypedDataDomain as EthersTypedDataDomain } from 'ethers';

export type TypedDataField = { name: string; type: string };
export type TypedDataDomain = EthersTypedDataDomain;

export interface EthersAnchorClientLike {
  anchor(payload: Array<{ key: Binary; value: Binary }>): Promise<string>;
}

export interface EthersSignerLike {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string>;
}

export interface EQTYServiceDeps {
  anchorClient?: EthersAnchorClientLike;
  signer?: EthersSignerLike;
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface EthersAnchorContractLike {
  anchor(anchors: Array<{ key: `0x${string}`; value: `0x${string}` }>): Promise<unknown>;
  maxAnchors(): Promise<bigint>;
}

export interface EthersServiceOptions {
  signer?: Signer;
  provider?: Provider;
  ethereumProvider?: EIP1193Provider;
  deps?: EQTYServiceDeps;
}
