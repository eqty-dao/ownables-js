import { AnchorClient, Binary, Event, Message } from 'eqty-core';
import {
  Contract,
  Interface,
  getAddress,
  type Provider,
  type Signer,
  type TypedDataDomain,
} from 'ethers';
import type {
  EthersAnchorContractLike,
  EthersServiceOptions,
  EthersSignerLike,
  TypedDataField,
} from '../types/EQTY';

const BASE_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const ZERO_HASH = Binary.fromHex(`0x${'0'.repeat(64)}`);

/* v8 ignore start */
// Default ethers adapters are integration wiring; DI-based unit tests inject deps instead.
class EthersSignerAdapter implements EthersSignerLike {
  constructor(private readonly signer: Signer) {}

  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string> {
    return this.signer.signTypedData(domain, types, value);
  }
}

class EthersAnchorContract implements EthersAnchorContractLike {
  private readonly contract: EthersAnchorContractLike;

  constructor(signer: Signer, address: `0x${string}`) {
    this.contract = new Contract(
      address,
      AnchorClient.ABI,
      signer
    ) as unknown as EthersAnchorContractLike;
  }

  async anchor(anchors: Array<{ key: `0x${string}`; value: `0x${string}` }>): Promise<string> {
    const tx = await this.contract.anchor(anchors);

    if (typeof tx === 'string') return tx;
    if (tx && typeof tx === 'object' && 'hash' in tx && typeof tx.hash === 'string') {
      return tx.hash;
    }

    throw new Error(`Unexpected anchor tx response: ${String(tx)}`);
  }

  async maxAnchors(): Promise<bigint> {
    return this.contract.maxAnchors();
  }
}
/* v8 ignore stop */

export default class EQTYService {
  private readonly provider: Provider;
  private readonly signerClient: Signer;
  private readonly anchorClient: AnchorClient<string>;
  private readonly anchorQueue: Array<{ key: Binary; value: Binary }> = [];
  public readonly signer: EthersSignerLike;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  private readonly lockableClientOverride;

  public constructor(
    public readonly address: string,
    public readonly chainId: number,
    options: EthersServiceOptions = {}
  ) {
    if (!this.isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    if (options.ethereumProvider && !options.signer) {
      throw new Error(
        'ethereumProvider is provided, but ethers Signer is required. Pass options.signer.'
      );
    }

    if (!options.signer) {
      throw new Error('No Ethereum signer found. Provide options.signer.');
    }

    this.signerClient = options.signer;
    this.provider =
      options.provider ??
      this.signerClient.provider ??
      (() => {
        throw new Error(
          'No Ethereum provider found. Provide options.provider or signer with provider.'
        );
      })();

    if (options.deps?.anchorClient) {
      this.anchorClient = options.deps.anchorClient as AnchorClient<string>;
    } else {
      /* v8 ignore start */
      const contractAddress = AnchorClient.contractAddress(this.chainId);
      const contract = new EthersAnchorContract(this.signerClient as Signer, contractAddress);
      this.anchorClient = new AnchorClient(contract);
      /* v8 ignore stop */
    }

    this.signer = options.deps?.signer ?? new EthersSignerAdapter(this.signerClient as Signer);
    this.logger = options.deps?.logger ?? console;
    this.lockableClientOverride = options.deps?.lockableClient;
  }

  private isSupportedChain(chainId: number): boolean {
    return chainId === BASE_CHAIN_ID || chainId === BASE_SEPOLIA_CHAIN_ID;
  }

  async anchor(
    ...anchors:
      | Array<{ key: { hex: string } | Binary; value: { hex: string } | Binary }>
      | Array<{ hex: string } | Binary>
  ): Promise<void> {
    if (anchors.length === 0) return;

    const toBinary = (value: { hex: string } | Binary): Binary =>
      value instanceof Binary ? value : Binary.fromHex(value.hex);

    const first = anchors[0] as { hex?: string } | Binary | undefined;
    if (first instanceof Binary || (first && 'hex' in first)) {
      for (const value of anchors as Array<{ hex: string } | Binary>) {
        const key = toBinary(value);
        this.anchorQueue.push({ key, value: ZERO_HASH });
      }
      return;
    }

    for (const entry of anchors as Array<{ key: { hex: string } | Binary; value: { hex: string } | Binary }>) {
      this.anchorQueue.push({
        key: toBinary(entry.key),
        value: toBinary(entry.value),
      });
    }
  }

  async submitAnchors(): Promise<string | undefined> {
    if (this.anchorQueue.length === 0) return undefined;

    const payload = this.anchorQueue.slice();
    this.anchorQueue.length = 0;

    try {
      return await this.anchorClient.anchor(payload);
    } catch (error) {
      this.anchorQueue.unshift(...payload);
      throw error;
    }
  }

  async sign(...subjects: Array<Event | Message>): Promise<void> {
    for (const subject of subjects) {
      await subject.signWith(this.signer as EthersSignerLike);
    }
  }

  async verifyAnchors(...anchors: Array<Binary | { hex: string } | { key: Binary | { hex: string }; value: Binary | { hex: string } }>): Promise<{
    verified: boolean;
    anchors: Record<string, string | undefined>;
    map: Record<string, string>;
  }> {
    if (anchors.length === 0) {
      return { verified: false, anchors: {}, map: {} };
    }

    const toBinary = (value: Binary | { hex: string }): Binary =>
      value instanceof Binary ? value : Binary.fromHex(value.hex);

    const pairs: Array<{ key: Binary; value: Binary }> = [];
    const first = anchors[0] as Binary | { hex: string } | { key: Binary | { hex: string }; value: Binary | { hex: string } };

    if (first instanceof Binary || ('hex' in (first as { hex?: string }) && !('key' in (first as { key?: unknown })))) {
      for (const anchor of anchors as Array<Binary | { hex: string }>) {
        pairs.push({ key: toBinary(anchor), value: ZERO_HASH });
      }
    } else {
      for (const anchor of anchors as Array<{ key: Binary | { hex: string }; value: Binary | { hex: string } }>) {
        pairs.push({ key: toBinary(anchor.key), value: toBinary(anchor.value) });
      }
    }

    const iface = new Interface([
      'event Anchored(bytes32 indexed key, bytes32 value, address indexed sender, uint64 timestamp)',
    ]);

    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100000);
    const contractAddress = AnchorClient.contractAddress(this.chainId);

    const txMap: Record<string, string | undefined> = {};
    const valueMap: Record<string, string> = {};
    let verified = true;

    for (const { key, value } of pairs) {
      try {
        const logs = await this.provider.getLogs({
          address: getAddress(contractAddress),
          fromBlock,
          toBlock: currentBlock,
          topics: [iface.getEvent('Anchored')?.topicHash ?? null, key.hex],
        });

        if (logs.length === 0) {
          txMap[key.hex] = undefined;
          valueMap[key.hex] = value.hex.toLowerCase();
          verified = false;
          continue;
        }

        const latest = logs[logs.length - 1];
        if (!latest) {
          txMap[key.hex] = undefined;
          valueMap[key.hex] = value.hex.toLowerCase();
          verified = false;
          continue;
        }
        const parsed = iface.parseLog(latest);
        const valueHex = (parsed?.args?.value as string | undefined)?.toLowerCase();

        txMap[key.hex] = latest.transactionHash;
        valueMap[key.hex] = valueHex ?? value.hex.toLowerCase();

        if (value.hex !== ZERO_HASH.hex && valueHex !== value.hex.toLowerCase()) {
          verified = false;
        }
      } catch (error) {
        this.logger.error(`Failed to verify anchor ${key.hex}:`, error);
        txMap[key.hex] = undefined;
        valueMap[key.hex] = value.hex.toLowerCase();
        verified = false;
      }
    }

    return {
      verified,
      anchors: txMap,
      map: valueMap,
    };
  }

  private lockableContract(address: string) {
    if (this.lockableClientOverride) return this.lockableClientOverride;

    /* v8 ignore next 15 */
    return new Contract(
      getAddress(address),
      [
        'function ownerOf(uint256 tokenId) view returns (address)',
        'function isLocked(uint256 tokenId) view returns (bool)',
        'function unlockChallenge(uint256 tokenId) view returns (bytes32)',
        'function isUnlockProofValid(uint256 tokenId, bytes proof) view returns (bool)',
      ],
      this.signerClient
    ) as unknown as {
      ownerOf(tokenId: bigint): Promise<string>;
      isLocked(tokenId: bigint): Promise<boolean>;
      unlockChallenge(tokenId: bigint): Promise<string | bigint>;
      isUnlockProofValid(tokenId: bigint, proof: string): Promise<boolean>;
    };
  }

  private normalizeChallenge(challenge: string | bigint): string {
    if (typeof challenge === 'bigint') {
      return `0x${challenge.toString(16).padStart(64, '0')}`;
    }

    return challenge;
  }

  async getOwner(contractAddress: string, tokenId: string): Promise<string> {
    return this.lockableContract(contractAddress).ownerOf(BigInt(tokenId));
  }

  async isLocked(contractAddress: string, tokenId: string): Promise<boolean> {
    return this.lockableContract(contractAddress).isLocked(BigInt(tokenId));
  }

  async getUnlockChallenge(contractAddress: string, tokenId: string): Promise<string> {
    const challenge = await this.lockableContract(contractAddress).unlockChallenge(BigInt(tokenId));
    return this.normalizeChallenge(challenge);
  }

  async signUnlockChallenge(challenge: string): Promise<string> {
    const bytes = challenge.startsWith('0x') ? challenge : `0x${Buffer.from(challenge, 'utf8').toString('hex')}`;
    return this.signerClient.signMessage(bytes);
  }

  async isUnlockProofValid(
    contractAddress: string,
    tokenId: string,
    proof: string
  ): Promise<boolean> {
    return this.lockableContract(contractAddress).isUnlockProofValid(BigInt(tokenId), proof);
  }
}
