import { describe, expect, it, vi } from "vitest";

import {
  buildInstantiateMsg,
  DOSSIER_BUNDLE_URL,
  deploy,
  estimateCost,
  prepareDossier,
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
        hasAttachments: false,
        isClosable: false,
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

  it("prepareOwnable allows zero-file dossier issuance when package service resolves a package", async () => {
    const packageService = {
      processPackage: vi.fn().mockResolvedValue({
        cid: "bafy-empty",
        title: "Dossier",
        name: "dossier",
        versions: [],
        isDynamic: true,
        hasMetadata: true,
        hasWidgetState: false,
        hasAttachments: true,
        isClosable: true,
        isConsumable: false,
        isConsumer: false,
        isTransferable: true,
      }),
    };

    const result = await prepareOwnable({
      name: "Dossier",
      description: "A living file dossier",
      files: [],
      packageService,
    });

    expect(result.packageCid).toBe("bafy-empty");
    expect(packageService.processPackage).toHaveBeenCalledWith([]);
  });

  it("prepareDossier loads the bundled dossier zip through the builder package", async () => {
    const extractAssets = vi.fn().mockResolvedValue([] as File[]);
    const packageService = {
      extractAssets,
      processPackage: vi.fn().mockResolvedValue({
        cid: "bafy-dossier",
        title: "Dossier",
        name: "dossier",
        versions: [],
        isDynamic: true,
        hasMetadata: true,
        hasWidgetState: false,
        hasAttachments: true,
        isClosable: true,
        isConsumable: false,
        isConsumer: false,
        isLockable: false,
        isTransferable: true,
      }),
    };
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(new Blob(["zip-bytes"], { type: "application/zip" }), {
        status: 200,
        statusText: "OK",
      })
    );

    const result = await prepareDossier({
      name: "Dossier",
      description: "A living file dossier",
      packageService,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(DOSSIER_BUNDLE_URL);
    expect(extractAssets).toHaveBeenCalledWith(expect.any(File));
    expect(packageService.processPackage).toHaveBeenCalledWith([]);
    expect(result.packageCid).toBe("bafy-dossier");
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
      ownable_type: "dossier",
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
