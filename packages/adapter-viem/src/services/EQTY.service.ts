import {
  AnchorClient,
  Binary,
  Event,
  Message,
  ViemContract,
  ViemSigner,
} from "eqty-core";
import type { PublicClient, WalletClient } from "viem";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  parseAbiItem,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { EQTYServiceDeps } from "../types/EQTY";

const ZERO_HASH = Binary.fromHex("0x" + "0".repeat(64));

/**
 * EQTYService
 */
export default class EQTYService {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private anchorClient: AnchorClient<any>;
  private anchorQueue: Array<{ key: Binary; value: Binary }> = [];
  public readonly signer: ViemSigner;
  private readonly lockableClientOverride;

  private getChain() {
    switch (this.chainId) {
      case base.id:
        return base;
      case baseSepolia.id:
        return baseSepolia;
      default:
        throw new Error(`Unsupported chain ID: ${this.chainId}`);
    }
  }

  public constructor(
    public readonly address: string,
    public readonly chainId: number,
    walletClient?: WalletClient,
    publicClient?: PublicClient,
    ethereumProvider?: any,
    deps: EQTYServiceDeps = {}
  ) {
    const chain = this.getChain();
    const eth = ethereumProvider;

    this.walletClient =
      walletClient ||
      (() => {
        if (!eth)
          throw new Error("No Ethereum provider found. Provide walletClient/publicClient or ethereumProvider.");
        return createWalletClient({
          account: getAddress(address),
          chain,
          transport: custom(eth),
        }) as WalletClient;
      })();

    this.publicClient =
      publicClient ||
      (() => {
        if (!eth)
          throw new Error("No Ethereum provider found. Provide walletClient/publicClient or ethereumProvider.");
        return createPublicClient({
          chain,
          transport: custom(eth),
        }) as PublicClient;
      })();

    if (deps.anchorClient) {
      this.anchorClient = deps.anchorClient as AnchorClient<any>;
    } else {
      const contract = new ViemContract(
        this.publicClient,
        this.walletClient,
        AnchorClient.contractAddress(this.chainId)
      );
      this.anchorClient = new AnchorClient(contract);
    }

    this.signer = deps.signer ?? new ViemSigner(this.walletClient);
    this.lockableClientOverride = deps.lockableClient;
  }

  async anchor(
    ...anchors:
      | Array<{
          key: { hex: string } | Binary;
          value: { hex: string } | Binary;
        }>
      | Array<{ hex: string } | Binary>
  ): Promise<void> {
    if (anchors.length === 0) return;
    const toBinary = (b: any) =>
      b instanceof Binary ? b : Binary.fromHex(b.hex);
    const first = anchors[0] as any;

    if (first instanceof Binary || (first && (first as any).hex)) {
      const list = (anchors as Array<any>).map((b) => toBinary(b));
      for (const val of list) {
        this.anchorQueue.push({ key: val, value: ZERO_HASH });
      }
    } else {
      const list = (anchors as Array<any>).map(({ key, value }) => ({
        key: toBinary(key),
        value: toBinary(value),
      }));
      this.anchorQueue.push(...list);
    }
  }

  async submitAnchors(): Promise<string | undefined> {
    if (this.anchorQueue.length === 0) return undefined;

    const payload = this.anchorQueue.slice();
    this.anchorQueue = [];
    try {
      return await this.anchorClient.anchor(payload);
    } catch (err) {
      this.anchorQueue.unshift(...payload);
      throw err;
    }
  }

  async sign(...subjects: Array<Event | Message>): Promise<void> {
    for (const subject of subjects) {
      await subject.signWith(this.signer);
    }
  }

  async verifyAnchors(...anchors: any[]): Promise<{
    verified: boolean;
    anchors: Record<string, string | undefined>;
    map: Record<string, string>;
  }> {
    if (anchors.length === 0) {
      return { verified: false, anchors: {}, map: {} };
    }

    const contractAddress = AnchorClient.contractAddress(this.chainId);
    const anchorsMap: Record<string, string> = {};
    const txHashes: Record<string, string | undefined> = {};
    let allVerified = true;

    const anchorPairs: Array<{ key: Binary; value: Binary }> = [];

    const toBinary = (b: any) =>
      b instanceof Binary ? b : Binary.fromHex(b.hex);
    const first = anchors[0] as any;

    if (first instanceof Binary || (first && (first as any).hex)) {
      for (const anchor of anchors as Array<any>) {
        const key = toBinary(anchor);
        anchorPairs.push({ key, value: ZERO_HASH });
      }
    } else {
      for (const anchor of anchors as Array<any>) {
        anchorPairs.push({
          key: toBinary(anchor.key),
          value: toBinary(anchor.value),
        });
      }
    }

    const anchoredEvent = parseAbiItem(
      "event Anchored(bytes32 indexed key, bytes32 value, address indexed sender, uint64 timestamp)"
    );

    const currentBlock = await (this.publicClient as any).getBlockNumber();
    const maxBlockRange = BigInt(100000);
    const fromBlock =
      currentBlock > maxBlockRange ? currentBlock - maxBlockRange : BigInt(0);

    for (const { key, value } of anchorPairs) {
      try {
        const logs = await (this.publicClient as any).getLogs({
          address: contractAddress as `0x${string}`,
          event: anchoredEvent,
          args: {
            key: key.hex as `0x${string}`,
          },
          fromBlock: fromBlock,
          toBlock: currentBlock,
        });

        if (logs.length > 0) {
          const latestLog = logs[logs.length - 1];
          txHashes[key.hex] = latestLog.transactionHash;

          if (value.hex !== ZERO_HASH.hex) {
            const logValue = (latestLog.args as any).value;
            const normalizedLogValue =
              typeof logValue === "string" ? logValue.toLowerCase() : logValue;
            const normalizedExpectedValue = value.hex.toLowerCase();

            anchorsMap[key.hex] = normalizedLogValue;

            if (normalizedLogValue !== normalizedExpectedValue) {
              allVerified = false;
            }
          } else {
            anchorsMap[key.hex] = value.hex.toLowerCase();
          }
        } else {
          txHashes[key.hex] = undefined;
          anchorsMap[key.hex] = value.hex.toLowerCase();
          allVerified = false;
        }
      } catch (error) {
        console.error(`Failed to verify anchor ${key.hex}:`, error);
        txHashes[key.hex] = undefined;
        anchorsMap[key.hex] = value.hex.toLowerCase();
        allVerified = false;
      }
    }

    return {
      verified: allVerified,
      anchors: txHashes,
      map: anchorsMap,
    };
  }

  private async lockableRead<T>(
    contractAddress: string,
    functionName: 'ownerOf' | 'isLocked' | 'unlockChallenge' | 'isUnlockProofValid',
    args: Array<bigint | string>
  ): Promise<T> {
    return (await (this.publicClient as any).readContract({
      address: contractAddress as `0x${string}`,
      abi: [
        { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'owner', type: 'address' }] },
        { name: 'isLocked', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'locked', type: 'bool' }] },
        { name: 'unlockChallenge', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'challenge', type: 'bytes32' }] },
        { name: 'isUnlockProofValid', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'proof', type: 'bytes' }], outputs: [{ name: 'valid', type: 'bool' }] },
      ],
      functionName,
      args,
    })) as T;
  }

  private normalizeChallenge(challenge: string | bigint): string {
    if (typeof challenge === 'bigint') {
      return `0x${challenge.toString(16).padStart(64, '0')}`;
    }

    return challenge;
  }

  async getOwner(contractAddress: string, tokenId: string): Promise<string> {
    if (this.lockableClientOverride) {
      return this.lockableClientOverride.ownerOf(BigInt(tokenId));
    }

    return this.lockableRead<string>(contractAddress, 'ownerOf', [BigInt(tokenId)]);
  }

  async isLocked(contractAddress: string, tokenId: string): Promise<boolean> {
    if (this.lockableClientOverride) {
      return this.lockableClientOverride.isLocked(BigInt(tokenId));
    }

    return this.lockableRead<boolean>(contractAddress, 'isLocked', [BigInt(tokenId)]);
  }

  async getUnlockChallenge(contractAddress: string, tokenId: string): Promise<string> {
    if (this.lockableClientOverride) {
      const challenge = await this.lockableClientOverride.unlockChallenge(BigInt(tokenId));
      return this.normalizeChallenge(challenge);
    }

    const challenge = await this.lockableRead<string | bigint>(contractAddress, 'unlockChallenge', [
      BigInt(tokenId),
    ]);
    return this.normalizeChallenge(challenge);
  }

  async signUnlockChallenge(challenge: string): Promise<string> {
    const account = (this.walletClient as any).account;
    if (!account) {
      throw new Error('Wallet client account is required for unlock challenge signing');
    }

    const raw = challenge.startsWith('0x')
      ? (challenge as `0x${string}`)
      : (`0x${Buffer.from(challenge, 'utf8').toString('hex')}` as `0x${string}`);

    return (this.walletClient as any).signMessage({
      account,
      message: { raw },
    });
  }

  async isUnlockProofValid(
    contractAddress: string,
    tokenId: string,
    proof: string
  ): Promise<boolean> {
    if (this.lockableClientOverride) {
      return this.lockableClientOverride.isUnlockProofValid(BigInt(tokenId), proof);
    }

    return this.lockableRead<boolean>(contractAddress, 'isUnlockProofValid', [
      BigInt(tokenId),
      proof,
    ]);
  }
}
