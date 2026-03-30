import { describe, expect, it, vi } from "vitest";

import {
  buildInstantiateMsg,
  deploy,
  estimateCost,
  FIXED_OWNABLE_TYPE,
  prepareOwnable,
} from "../src";

describe("@ownables/builder", () => {
  it("prepareOwnable validates metadata and returns package cid", async () => {
    const packageService = {
      processPackage: vi.fn().mockResolvedValue({
        cid: "bafy-test",
        title: "Example",
        name: "example",
        versions: [],
        isDynamic: false,
        hasMetadata: false,
        hasWidgetState: false,
        isConsumable: false,
        isConsumer: false,
        isTransferable: false,
      }),
    };

    const result = await prepareOwnable({
      name: "Ownable",
      description: "Static ownable",
      files: [{} as File],
      packageService,
      keywords: ["k1"],
    });

    expect(result.packageCid).toBe("bafy-test");
    expect(result.pkg.description).toBe("Static ownable");
    expect(packageService.processPackage).toHaveBeenCalledTimes(1);
  });

  it("buildInstantiateMsg builds payload with fixed ownable type", () => {
    const payload = buildInstantiateMsg({
      name: "Name",
      description: "Desc",
      packageCid: "bafy-test",
      networkId: 84,
      keywords: ["a"],
    });

    expect(payload).toEqual({
      name: "Name",
      description: "Desc",
      package: "bafy-test",
      network_id: 84,
      ownable_type: FIXED_OWNABLE_TYPE,
      keywords: ["a"],
    });
  });

  it("deploy verifies code hash when adapter supports it", async () => {
    const adapter = {
      deployContract: vi.fn().mockResolvedValue({
        txHash: "0x1",
        contractAddress: "addr-1",
      }),
      getCodeHash: vi.fn().mockResolvedValue("0xabc"),
    };

    await expect(
      deploy(adapter, {
        instantiateMsg: buildInstantiateMsg({
          name: "Name",
          description: "Desc",
          packageCid: "bafy-test",
          networkId: 84,
        }),
        wasm: new Uint8Array([1]),
        expectedCodeHash: "0xabc",
      })
    ).resolves.toEqual({
      txHash: "0x1",
      contractAddress: "addr-1",
      codeHash: "0xabc",
    });

    await expect(
      deploy(adapter, {
        instantiateMsg: buildInstantiateMsg({
          name: "Name",
          description: "Desc",
          packageCid: "bafy-test",
          networkId: 84,
        }),
        wasm: new Uint8Array([1]),
        expectedCodeHash: "0xdef",
      })
    ).rejects.toThrow("Code hash mismatch");
  });

  it("estimateCost derives eth/usd from local gas and price inputs", () => {
    expect(
      estimateCost({ gasUnits: 1_000_000n, gasPriceGwei: 0.25, nativePriceUsd: 2000 })
    ).toEqual({ eth: "0.000250", usd: "0.50" });

    expect(estimateCost({ fallbackEth: "0.010000" })).toEqual({ eth: "0.010000" });
  });
});
