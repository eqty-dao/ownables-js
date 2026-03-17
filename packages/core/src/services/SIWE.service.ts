import { ViemSigner } from "eqty-core";
import type { SIWEMessage, SIWEAuthResult, SIWEClientDeps } from "../types/SIWE";

export class SIWEClient {
  private readonly domain: string;
  private readonly version: string = "1";
  private readonly fetchFn: (input: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<any> }>;
  private readonly now: () => Date;
  private readonly nonceGenerator: (() => string) | undefined;

  constructor(domain?: string, deps: SIWEClientDeps = {}) {
    this.domain = domain || "localhost:8000";
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => new Date());
    this.nonceGenerator = deps.nonceGenerator;
  }

  generateNonce(): string {
    if (this.nonceGenerator) return this.nonceGenerator();
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  createMessage(
    address: string,
    uri: string,
    chainId: number = 84532
  ): SIWEMessage {
    return {
      domain: this.domain,
      address,
      statement: "Sign in with Ethereum to the EQTY Relay",
      uri,
      version: this.version,
      chainId,
      nonce: this.generateNonce(),
      issuedAt: this.now().toISOString(),
    };
  }

  async signMessage(message: SIWEMessage, signer: ViemSigner): Promise<string> {
    const domain = {
      name: "Sign-In with Ethereum",
      version: this.version,
      chainId: message.chainId,
    };

    const types = {
      Message: [
        { name: "domain", type: "string" },
        { name: "address", type: "address" },
        { name: "statement", type: "string" },
        { name: "uri", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "issuedAt", type: "string" },
        { name: "expirationTime", type: "string" },
        { name: "notBefore", type: "string" },
        { name: "requestId", type: "string" },
        { name: "resources", type: "string[]" },
      ],
    };

    const value = {
      domain: message.domain,
      address: message.address,
      statement: message.statement || "",
      uri: message.uri,
      version: message.version,
      chainId: message.chainId,
      nonce: message.nonce,
      issuedAt: message.issuedAt,
      expirationTime: message.expirationTime || "",
      notBefore: message.notBefore || "",
      requestId: message.requestId || "",
      resources: message.resources || [],
    };

    return await signer.signTypedData(domain, types, value);
  }

  async authenticate(
    signer: ViemSigner,
    relayUrl: string,
    chainId: number = 84532
  ): Promise<SIWEAuthResult> {
    try {
      const address = await signer.getAddress();
      const uri = `${relayUrl}/auth/verify`;

      const message = this.createMessage(address, uri, chainId);
      const signature = await this.signMessage(message, signer);

      const response = await this.fetchFn(`${relayUrl}/auth/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          signature,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          error: error.error || "Authentication failed",
        };
      }

      const result = await response.json();
      return {
        success: true,
        address: result.address,
        token: result.token,
        expiresIn: result.expiresIn,
      };
    } catch (error) {
      return {
        success: false,
        error: `Authentication failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  async getNonce(relayUrl: string): Promise<string> {
    try {
      const response = await this.fetchFn(`${relayUrl}/auth/nonce`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to get nonce");
      }

      const result = await response.json();
      return result.nonce;
    } catch (error) {
      throw new Error(
        `Failed to get nonce: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
