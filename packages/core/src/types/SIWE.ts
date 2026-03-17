export interface SIWEMessage {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

export interface SIWEAuthResult {
  success: boolean;
  address?: string;
  token?: string;
  expiresIn?: string;
  error?: string;
}

export interface SIWEClientDeps {
  fetchFn?: (input: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<any> }>;
  now?: () => Date;
  nonceGenerator?: () => string;
}
