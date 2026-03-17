import { Binary, Event, Message } from 'eqty-core';
import type { TypedDataDomain, TypedDataField } from '../types/EQTY';

const DUMMY_SIG = `0x${'1'.repeat(130)}`;

class MockSigner {
  constructor(private readonly address: string) {}

  async getAddress(): Promise<string> {
    return this.address;
  }

  async signTypedData(
    _domain: TypedDataDomain,
    _types: Record<string, TypedDataField[]>,
    _value: Record<string, unknown>
  ): Promise<string> {
    return DUMMY_SIG;
  }
}

export default class MockEQTYService {
  public readonly signer: MockSigner;
  private readonly anchorQueue: Array<{ key: Binary; value: Binary }> = [];

  constructor(
    public readonly address: string,
    public readonly chainId: number
  ) {
    this.signer = new MockSigner(address);
  }

  async anchor(
    ...anchors:
      | Array<{ key: { hex: string } | Binary; value: { hex: string } | Binary }>
      | Array<{ hex: string } | Binary>
  ): Promise<void> {
    if (anchors.length === 0) return;

    const toBinary = (value: Binary | { hex: string }): Binary =>
      value instanceof Binary ? value : Binary.fromHex(value.hex);

    const first = anchors[0] as Binary | { hex?: string } | undefined;
    if (first instanceof Binary || (first && 'hex' in first)) {
      for (const value of anchors as Array<Binary | { hex: string }>) {
        const key = toBinary(value);
        this.anchorQueue.push({ key, value: Binary.fromHex(`0x${'0'.repeat(64)}`) });
      }
      return;
    }

    for (const anchor of anchors as Array<{ key: Binary | { hex: string }; value: Binary | { hex: string } }>) {
      this.anchorQueue.push({ key: toBinary(anchor.key), value: toBinary(anchor.value) });
    }
  }

  async submitAnchors(): Promise<string | undefined> {
    if (this.anchorQueue.length === 0) return undefined;
    this.anchorQueue.length = 0;
    return `0x${'a'.repeat(64)}`;
  }

  async sign(...subjects: Array<Event | Message>): Promise<void> {
    for (const subject of subjects) {
      await subject.signWith(this.signer);
    }
  }

  async verifyAnchors(...anchors: Array<Binary | { hex: string } | { key: Binary | { hex: string }; value: Binary | { hex: string } }>): Promise<{
    verified: boolean;
    anchors: Record<string, string | undefined>;
    map: Record<string, string>;
  }> {
    const txMap: Record<string, string | undefined> = {};
    const valueMap: Record<string, string> = {};

    const toBinary = (value: Binary | { hex: string }): Binary =>
      value instanceof Binary ? value : Binary.fromHex(value.hex);

    const first = anchors[0] as Binary | { hex?: string } | { key?: unknown } | undefined;

    if (first instanceof Binary || (first && 'hex' in first && !('key' in first))) {
      for (const anchor of anchors as Array<Binary | { hex: string }>) {
        const key = toBinary(anchor).hex;
        txMap[key] = `0x${'b'.repeat(64)}`;
        valueMap[key] = Binary.fromHex(`0x${'0'.repeat(64)}`).hex.toLowerCase();
      }
      return { verified: true, anchors: txMap, map: valueMap };
    }

    for (const anchor of anchors as Array<{ key: Binary | { hex: string }; value: Binary | { hex: string } }>) {
      const key = toBinary(anchor.key).hex;
      const value = toBinary(anchor.value).hex.toLowerCase();
      txMap[key] = `0x${'b'.repeat(64)}`;
      valueMap[key] = value;
    }

    return { verified: true, anchors: txMap, map: valueMap };
  }
}
