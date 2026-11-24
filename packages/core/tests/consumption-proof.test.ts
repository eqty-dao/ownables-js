import { describe, expect, it, vi } from 'vitest';
import { Binary, Event, EventChain } from 'eqty-core';
import JSZip from 'jszip';
import { verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import OwnableService from '../src/services/Ownable.service';
import { ConsumptionEvidencePendingError } from '../src/index';
import { PublicEventReplayService } from '../src/services/ReplayAuthority.service';
import type {
  AnchorValidationResult,
  ConsumptionVerificationOptions,
  OwnableRPC,
  SignedConsumeIngestEvent,
} from '../src/index';
import { calculateOwnablePackageCid } from '../src/utils/calculateOwnablePackageCid';
import { calculateAttachmentCid, createConsumptionSnapshot } from '../src/utils/ownableArchive';

const account = privateKeyToAccount(`0x${'ab'.repeat(32)}`);
const address = account.address;
const signer = {
  getAddress: async () => address,
  signTypedData: (domain: any, types: any, message: any) =>
    account.signTypedData({ domain, types, message, primaryType: 'Event' }),
};
const wasm = new Uint8Array([1, 2, 3]);
const wasmPath = 'ownable_bg.wasm';
const fixtureZip = () => new JSZip().file(wasmPath, wasm);

function evidence(chain: EventChain): AnchorValidationResult {
  const result: AnchorValidationResult = { verified: true, anchors: {}, details: {}, map: {} };
  for (const [index, { key, value }] of chain.anchorMap.entries()) {
    const transactionHash = `0x${'aa'.repeat(32)}`;
    result.anchors[key.hex] = transactionHash;
    result.map[key.hex] = value.hex;
    result.details[key.hex] = {
      key: key.hex,
      expectedValue: value.hex,
      value: value.hex,
      source: 'provider',
      transactionHash,
      verified: true,
      blockNumber: index + 1,
      transactionIndex: 0,
      logIndex: 0,
    };
  }
  return result;
}

async function createChain(packageCid: string): Promise<EventChain> {
  const chain = EventChain.create(address, 84532);
  await new Event({
    '@context': 'instantiate_msg.json',
    ownable_id: chain.id,
    network_id: chain.networkId,
    package: packageCid,
  })
    .addTo(chain)
    .signWith(signer);
  return chain;
}

async function signCommand(source: EventChain, target: EventChain) {
  const event = new Event({
    '@context': 'execute_msg.json',
    consume: { consumer_id: target.id },
  }).addTo(source);
  await event.signWith(signer);
  return event;
}

async function signClaim(target: EventChain, claim: SignedConsumeIngestEvent) {
  await new Event({ '@context': 'ingest_msg.json', ...claim }).addTo(target).signWith(signer);
}

async function fixture() {
  const packageCid = await calculateOwnablePackageCid([{ path: wasmPath, content: wasm }]);
  const target = await createChain(packageCid);
  const source = await createChain(packageCid);
  const file = new Uint8Array([9, 8, 7]);
  const cid = await calculateAttachmentCid(file);
  await new Event({
    '@context': 'execute_msg.json',
    attach: { attachments: [{ cid, name: 'record.txt' }] },
  })
    .addTo(source)
    .signWith(signer);
  const event = await signCommand(source, target);
  const snapshot = await createConsumptionSnapshot(source, fixtureZip());
  const claim: SignedConsumeIngestEvent = {
    type: 'consume',
    source: {
      id: source.id,
      owner: address,
      issuer: address,
      event: event.hash.hex,
      cid: snapshot.cid,
    },
    target: { id: target.id },
    attributes: { color: '#f00' },
  };
  const attachments = new Map([
    [snapshot.cid, snapshot.bytes],
    [cid, file],
  ]);
  const rpc = {
    initialize: vi.fn(),
    instantiate: vi.fn().mockResolvedValue({ state: [] }),
    execute: vi.fn().mockResolvedValue({
      state: [],
      events: [{ type: 'consume', attributes: { color: '#f00' } }],
    }),
    register: vi.fn().mockResolvedValue({ state: [] }),
    query: vi.fn().mockResolvedValue({ owner: address, issuer: address }),
    ingest: vi.fn().mockResolvedValue({ state: [] }),
    terminate: vi.fn(),
  };
  const options: ConsumptionVerificationOptions = {
    getAttachment: async (cid) => attachments.get(cid),
    verifySignature: async (address, domain, types, message, signature) =>
      verifyTypedData({
        address: address as `0x${string}`,
        domain,
        types,
        message,
        primaryType: 'Event',
        signature: signature as `0x${string}`,
      }),
    verifyAnchors: async (chain) => evidence(chain),
    getPublicEvents: async () => [],
  };
  const service = new OwnableService({
    stateStore: {} as any,
    eventChains: {} as any,
    anchorProvider: {} as any,
    packages: { zip: async () => fixtureZip() } as any,
    runtimeSource: { getWorkerSource: () => '' },
    runtimeRpc: { create: () => rpc as unknown as OwnableRPC },
    replay: new PublicEventReplayService(),
    consumption: options,
  });
  return { service, options, source, target, claim, attachments, cid, packageCid, rpc };
}

describe('signed consumption proof replay', () => {
  it('verifies nested signed chains and resolves shared attachments outside the source snapshots', async () => {
    const fixtureData = await fixture();
    const { service, source, target, claim, attachments, packageCid, rpc } = fixtureData;
    await signClaim(target, claim);
    const outer = await createChain(packageCid);
    const terminal = await signCommand(target, outer);
    const snapshot = await createConsumptionSnapshot(target, fixtureZip());
    attachments.set(snapshot.cid, snapshot.bytes);
    await signClaim(outer, {
      ...claim,
      source: { ...claim.source, id: target.id, event: terminal.hash.hex, cid: snapshot.cid },
      target: { id: outer.id },
    });

    await expect(service.verifyConsumptionChain(EventChain.from(outer.toJSON()))).resolves.toEqual(
      []
    );
    expect(rpc.ingest.mock.calls).toHaveLength(2);
    const [nested, root] = rpc.ingest.mock.calls.map(([request]) => request);
    expect(nested.source).toEqual({
      id: source.id,
      owner: address,
      issuer: address,
      event: claim.source.event,
    });
    expect(root.source).not.toHaveProperty('cid');
    expect(rpc.terminate).toHaveBeenCalledTimes(3);
  });

  it('cannot verify missing anchor evidence and rejects an authoritative competing branch', async () => {
    const { service, options, source, target, claim } = await fixture();
    await signClaim(target, claim);
    options.verifyAnchors = async (chain) =>
      chain.id === source.id
        ? { verified: false, anchors: {}, details: {}, map: {} }
        : evidence(chain);
    await expect(service.replayConsumptionChain(target)).resolves.toMatchObject({
      verified: false,
    });
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow(
      'Missing authoritative anchor'
    );

    options.verifyAnchors = async (chain) => {
      const result = evidence(chain);
      if (chain.id === source.id) {
        const terminal = result.details[chain.anchorMap.at(-1)!.key.hex]!;
        terminal.value = `0x${'cd'.repeat(32)}`;
        terminal.verified = false;
      }
      return result;
    };
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow(
      'contradictory authoritative anchor'
    );
  });

  it('applies authoritative public events before the bound consume, and defers if their order is unavailable', async () => {
    const { service, options, source, target, claim, rpc } = await fixture();
    await signClaim(target, claim);
    const publicEvent = {
      source: address,
      eventType: 'mix',
      data: '0x01',
      transactionHash: `0x${'de'.repeat(32)}`,
      blockNumber: 2,
      transactionIndex: 1,
      logIndex: 0,
    };
    options.getPublicEvents = async (chain) => (chain.id === source.id ? [publicEvent] : []);
    const mixed = [[Uint8Array.of(1), Uint8Array.of(2)]];
    rpc.register.mockResolvedValue({ state: mixed });
    rpc.execute.mockImplementation(async (message, _info, state) => ({
      state: [],
      events: [
        {
          type: 'consume',
          attributes: { color: !message.consume || state === mixed ? '#f00' : '#0f0' },
        },
      ],
    }));

    await expect(service.verifyConsumptionChain(target)).resolves.toEqual([]);
    expect(rpc.execute.mock.lastCall?.[2]).toBe(mixed);

    options.verifyAnchors = async (chain) =>
      chain.id === source.id
        ? { verified: false, anchors: {}, details: {}, map: {} }
        : evidence(chain);
    await expect(service.replayConsumptionChain(target)).rejects.toBeInstanceOf(
      ConsumptionEvidencePendingError
    );
    expect(rpc.ingest).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate use of a signed consume command with a different ZIP CID', async () => {
    const { service, source, target, claim, attachments, rpc } = await fixture();
    await signClaim(target, claim);
    const alternative = await createConsumptionSnapshot(
      source,
      fixtureZip().file('timestamp.txt', 'alt')
    );
    expect(alternative.cid).not.toBe(claim.source.cid);
    attachments.set(alternative.cid, alternative.bytes);
    await signClaim(target, { ...claim, source: { ...claim.source, cid: alternative.cid } });
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow('Duplicate consume event');
    expect(rpc.ingest).toHaveBeenCalledTimes(1);
  });

  it('rejects a receiver with a valid signature but a consume command bound elsewhere', async () => {
    const { service, target, claim, packageCid, rpc } = await fixture();
    const otherTarget = await createChain(packageCid);
    expect(otherTarget.id).not.toBe(target.id);
    await signClaim(otherTarget, { ...claim, target: { id: otherTarget.id } });
    await expect(service.verifyConsumptionChain(otherTarget)).rejects.toThrow(
      'bound to the receiver'
    );
    expect(rpc.ingest).not.toHaveBeenCalled();
  });

  it('rejects forged semantic claims before passing them to the consumer contract', async () => {
    const { service, target, claim, rpc } = await fixture();
    await signClaim(target, { ...claim, attributes: { color: '#0f0' } });
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow(
      'differs from the verified source'
    );
    expect(rpc.ingest).not.toHaveBeenCalled();
  });

  it('rejects missing descendant content, wrong CID bytes, and invalid signatures', async () => {
    const { service, target, claim, attachments, cid, rpc } = await fixture();
    await signClaim(target, claim);
    const nested = attachments.get(cid)!;
    attachments.delete(cid);
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow(
      'Missing consumption attachment'
    );
    attachments.set(cid, nested);
    attachments.set(claim.source.cid, new Uint8Array([8]));
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow('bytes do not match CID');
    target.events.at(-1)!.signature = Binary.fromHex(`0x${'77'.repeat(65)}`);
    await expect(service.verifyConsumptionChain(target)).rejects.toThrow('Invalid signature');
    expect(rpc.ingest).not.toHaveBeenCalled();
  });
});
