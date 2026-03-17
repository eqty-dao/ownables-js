import type { Binary, ViemSigner } from 'eqty-core';

export type TypedDataDomain = Record<string, unknown>;
export type TypedDataField = { name: string; type: string };

export interface EQTYServiceDeps {
  anchorClient?: { anchor(payload: Array<{ key: Binary; value: Binary }>): Promise<string> };
  signer?: ViemSigner;
}
