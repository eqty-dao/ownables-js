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
  zeroAddress,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  buildAnchorValidationResult,
  normalizeAnchorValidationPairs,
  ZERO_ANCHOR_VALUE,
  type AnchorValidationResult,
} from "@ownables/core";
import type {
  AnchorClientLike,
  AnchorFeeReader,
  AnchorTxOptions,
  EqtyTokenReader,
  EQTYServiceDeps,
  PublicEventClientLike,
} from "../types/EQTY";

/**
 * EQTYService
 */
export default class EQTYService {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private anchorClient: AnchorClientLike;
  private publicEventClient: PublicEventClientLike;
  private feeReader: AnchorFeeReader;
  private anchorQueue: Array<{ key: Binary; value: Binary }> = [];
  public readonly signer: ViemSigner;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  private readonly lockableClientOverride;
  private readonly eqtyTokenOverride;

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
      this.anchorClient = deps.anchorClient;
    } else {
      const contract = new ViemContract(
        this.publicClient,
        this.walletClient,
        AnchorClient.contractAddress(this.chainId)
      );
      this.anchorClient = new AnchorClient(contract) as unknown as AnchorClientLike;
    }

    this.publicEventClient =
      deps.publicEventClient ??
      {
        emitPublicEvent: async (
          subjectId: string,
          eventType: string,
          data: Uint8Array,
          txOptions?: AnchorTxOptions
        ) => {
          const transactionHash = await (this.walletClient as any).writeContract({
            account: (this.walletClient as any).account,
            address: AnchorClient.contractAddress(this.chainId) as `0x${string}`,
            abi: [
              {
                type: 'function',
                name: 'emitPublicEvent',
                stateMutability: 'payable',
                inputs: [
                  { name: 'subjectId', type: 'bytes32' },
                  { name: 'eventType', type: 'string' },
                  { name: 'data', type: 'bytes' },
                ],
                outputs: [],
              },
            ],
            functionName: 'emitPublicEvent',
            args: [subjectId, eventType, data],
            value: txOptions?.value,
          });
          const receipt = await (this.publicClient as any).waitForTransactionReceipt({ hash: transactionHash });
          const publicEventAbi = parseAbiItem(
            'event PublicEvent(bytes32 indexed subjectId, address indexed source, string eventType, bytes data, uint64 timestamp)'
          );
          const logs = await (this.publicClient as any).getLogs({
            address: AnchorClient.contractAddress(this.chainId) as `0x${string}`,
            event: publicEventAbi,
            fromBlock: receipt.blockNumber,
            toBlock: receipt.blockNumber,
          });
          const log = logs.find(
            (entry: any) =>
              entry.transactionHash === transactionHash &&
              entry.args?.subjectId?.toLowerCase?.() === subjectId.toLowerCase()
          );

          if (!log) {
            throw new Error('PublicEvent log not found in transaction receipt');
          }

          return {
            source: log.args.source as string,
            eventType: log.args.eventType as string,
            data:
              typeof log.args.data === 'string'
                ? Binary.fromHex(log.args.data).hex
                : new Binary(log.args.data as Uint8Array).hex,
            blockNumber: Number(receipt.blockNumber),
            transactionHash,
            transactionIndex: Number(receipt.transactionIndex ?? receipt.index ?? 0),
            logIndex: Number(log.logIndex),
            timestamp: log.args.timestamp !== undefined ? Number(log.args.timestamp) : undefined,
          };
        },
      };

    this.feeReader = deps.feeReader ?? this;

    this.signer = deps.signer ?? new ViemSigner(this.walletClient);
    this.logger = deps.logger ?? console;
    this.lockableClientOverride = deps.lockableClient;
    this.eqtyTokenOverride = deps.eqtyToken;
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
        this.anchorQueue.push({ key: val, value: ZERO_ANCHOR_VALUE });
      }
    } else {
      const list = (anchors as Array<any>).map(({ key, value }) => ({
        key: toBinary(key),
        value: toBinary(value),
      }));
      this.anchorQueue.push(...list);
    }
  }

  async submitAnchors(txOptions?: AnchorTxOptions): Promise<string | undefined> {
    if (this.anchorQueue.length === 0) return undefined;

    const payload = this.anchorQueue.slice();
    this.anchorQueue = [];
    try {
      const nextTxOptions = txOptions ?? (await this.resolveAnchorTxOptions(payload.length));
      return await this.anchorClient.anchor(payload, nextTxOptions);
    } catch (err) {
      this.anchorQueue.unshift(...payload);
      throw err;
    }
  }

  async emitPublicEvent(
    subjectId: string,
    eventType: string,
    data: Uint8Array,
    txOptions?: AnchorTxOptions
  ) {
    const nextTxOptions = txOptions ?? (await this.resolveAnchorTxOptions(1));
    return this.publicEventClient.emitPublicEvent(subjectId, eventType, data, nextTxOptions);
  }

  async quoteEqtyCost(count: bigint): Promise<bigint> {
    return (await (this.publicClient as any).readContract({
      address: AnchorClient.contractAddress(this.chainId),
      abi: [{ name: 'quoteEqtyCost', type: 'function', stateMutability: 'view', inputs: [{ name: 'count', type: 'uint256' }], outputs: [{ name: 'cost', type: 'uint256' }] }],
      functionName: 'quoteEqtyCost',
      args: [count],
    })) as bigint;
  }

  async quoteEthCost(count: bigint): Promise<bigint> {
    return (await (this.publicClient as any).readContract({
      address: AnchorClient.contractAddress(this.chainId),
      abi: [{ name: 'quoteEthCost', type: 'function', stateMutability: 'view', inputs: [{ name: 'count', type: 'uint256' }], outputs: [{ name: 'cost', type: 'uint256' }] }],
      functionName: 'quoteEthCost',
      args: [count],
    })) as bigint;
  }

  async eqtyToken(): Promise<string> {
    return (await (this.publicClient as any).readContract({
      address: AnchorClient.contractAddress(this.chainId),
      abi: [{ name: 'eqtyToken', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'token', type: 'address' }] }],
      functionName: 'eqtyToken',
      args: [],
    })) as string;
  }

  async allowance(owner: string, spender: string): Promise<bigint> {
    return (await (this.publicClient as any).readContract({
      address: spender as `0x${string}`,
      abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'remaining', type: 'uint256' }] }],
      functionName: 'allowance',
      args: [owner, spender],
    })) as bigint;
  }

  private async resolveAnchorTxOptions(count: number): Promise<AnchorTxOptions> {
    const batchSize = BigInt(count);
    const quotedEqtyCost = await this.feeReader.quoteEqtyCost(batchSize);

    if (quotedEqtyCost === 0n) {
      return { value: 0n };
    }

    const anchorAddress = AnchorClient.contractAddress(this.chainId);
    const eqtyTokenAddress = await this.feeReader.eqtyToken();
    if (eqtyTokenAddress !== zeroAddress) {
      const eqtyToken: EqtyTokenReader =
        this.eqtyTokenOverride ??
        {
          allowance: async (owner: string, spender: string) =>
            (await (this.publicClient as any).readContract({
              address: eqtyTokenAddress as `0x${string}`,
              abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'remaining', type: 'uint256' }] }],
              functionName: 'allowance',
              args: [owner, spender],
            })) as bigint,
        };
      const allowance = await eqtyToken.allowance(this.address, anchorAddress);

      if (allowance >= quotedEqtyCost) {
        return { value: 0n };
      }
    }

    const quotedEthCost = await this.feeReader.quoteEthCost(batchSize);
    return { value: quotedEthCost };
  }

  async sign(...subjects: Array<Event | Message>): Promise<void> {
    for (const subject of subjects) {
      await subject.signWith(this.signer);
    }
  }

  async validateAnchors(...anchors: any[]): Promise<AnchorValidationResult> {
    if (anchors.length === 0) {
      return { verified: false, anchors: {}, map: {}, details: {} };
    }

    const contractAddress = AnchorClient.contractAddress(this.chainId);
    const anchorPairs = normalizeAnchorValidationPairs(...anchors);

    const anchoredEvent = parseAbiItem(
      "event Anchored(bytes32 indexed key, bytes32 value, address indexed sender, uint64 timestamp)"
    );

    const currentBlock = await (this.publicClient as any).getBlockNumber();
    const maxBlockRange = BigInt(100000);
    const fromBlock =
      currentBlock > maxBlockRange ? currentBlock - maxBlockRange : BigInt(0);

    const records = [];
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
          const logValue = (latestLog.args as any).value;
          const normalizedLogValue =
            typeof logValue === "string" ? logValue.toLowerCase() : value.hex.toLowerCase();
          records.push({
            key: key.hex,
            expectedValue: value.hex.toLowerCase(),
            value: normalizedLogValue,
            transactionHash: latestLog.transactionHash,
            verified: value.hex === ZERO_ANCHOR_VALUE.hex || normalizedLogValue === value.hex.toLowerCase(),
            source: "provider" as const,
            ...(latestLog.args?.timestamp !== undefined ? { timestamp: Number(latestLog.args.timestamp) } : {}),
            ...(latestLog.blockNumber !== undefined ? { blockNumber: Number(latestLog.blockNumber) } : {}),
            ...(latestLog.transactionIndex !== undefined ? { transactionIndex: Number(latestLog.transactionIndex) } : {}),
            ...(latestLog.logIndex !== undefined ? { logIndex: Number(latestLog.logIndex) } : {}),
          });
        } else {
          records.push(undefined);
        }
      } catch (error) {
        this.logger.error(`Failed to verify anchor ${key.hex}:`, error);
        records.push(undefined);
      }
    }

    return buildAnchorValidationResult(anchorPairs, records);
  }

  async verifyAnchors(...anchors: any[]): Promise<AnchorValidationResult> {
    return this.validateAnchors(...anchors);
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
