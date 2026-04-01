import type { IEventChainJSON } from 'eqty-core';

export interface StoredChainInfo {
  chain: IEventChainJSON;
  state: string;
  package: string;
  isConsumed?: boolean;
  uniqueMessageHash: string;
  created: Date;
  latestHash: string;
  keywords: string[];
}
