import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type * as BuilderModule from "../src";
import { describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";

import {
  buildInstantiateMsg,
  DOSSIER_BUNDLE_URL,
  deploy,
  estimateCost,
  prepareDossier,
  prepareOwnable,
} from "../src";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PACKAGE_ROOT = `${REPO_ROOT}/packages/builder`;
const BUILT_INDEX_PATH = `${PACKAGE_ROOT}/${packageJson.main}`;
const BUILT_TYPES_PATH = `${PACKAGE_ROOT}/${packageJson.types}`;

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

  it("prepareDossier prefers caller metadata over bundled dossier defaults", async () => {
    const extractAssets = vi.fn().mockResolvedValue([] as File[]);
    const packageService = {
      extractAssets,
      processPackage: vi.fn().mockResolvedValue({
        cid: "bafy-dossier",
        title: "Dossier",
        name: "dossier",
        description: "Bundled dossier description",
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
      name: "Customer dossier",
      description: "Issued from the SDK",
      packageService,
      fetchFn,
      keywords: ["sdk"],
    });

    expect(result.pkg.title).toBe("Customer dossier");
    expect(result.pkg.description).toBe("Issued from the SDK");
    expect(result.pkg.keywords).toEqual(["sdk"]);
  });

  it("prepareDossier can stage an optional thumbnail.webp asset for the package service", async () => {
    const bundledFiles = [
      new File(["bundle"], "package.json", { type: "application/json" }),
      new File(["default-thumb"], "thumbnail.webp", { type: "image/webp" }),
      new File(["meta"], "metadata.json", { type: "application/json" }),
    ];
    const extractAssets = vi.fn().mockResolvedValue(bundledFiles);
    const packageService = {
      extractAssets,
      processPackage: vi.fn().mockResolvedValue({
        cid: "bafy-dossier",
        title: "Dossier",
        name: "dossier",
        description: "Bundled dossier description",
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
    const thumbnail = new File(["custom-thumb"], "picked.png", { type: "image/png" });

    await prepareDossier({
      name: "Customer dossier",
      description: "Issued from the SDK",
      packageService,
      fetchFn,
      thumbnail,
    });

    expect(packageService.processPackage).toHaveBeenCalledTimes(1);
    const files = packageService.processPackage.mock.calls[0]?.[0];
    if (!files) {
      throw new Error("Expected processPackage to be called with staged files");
    }
    expect(files.map((file: File) => file.name)).toEqual([
      "package.json",
      "metadata.json",
      "thumbnail.webp",
    ]);
    const stagedThumbnail = files.find((file: File) => file.name === "thumbnail.webp");
    if (!stagedThumbnail) {
      throw new Error("Expected staged thumbnail.webp asset");
    }
    expect(stagedThumbnail).toBeInstanceOf(File);
    expect(await stagedThumbnail.text()).toBe("custom-thumb");
    expect(stagedThumbnail.type).toBe("image/png");
  });

  it("prepareDossier works through the built package bundle path", async () => {
    await rm(`${PACKAGE_ROOT}/dossier.zip`, { force: true });
    await rm(`${REPO_ROOT}/ownables/dossier.zip`, { force: true });
    await rm(`${PACKAGE_ROOT}/dist/builder/src/dossier.zip`, { force: true });

    await execFileAsync("yarn", ["workspace", "@ownables/builder", "build"], {
      cwd: REPO_ROOT,
    });

    await access(BUILT_INDEX_PATH);
    await access(BUILT_TYPES_PATH);
    const builtBuilder = (await import(pathToFileURL(BUILT_INDEX_PATH).href)) as typeof BuilderModule;
    const bundlePath = fileURLToPath(builtBuilder.DOSSIER_BUNDLE_URL);
    await access(bundlePath);

    const extractAssets = vi.fn().mockResolvedValue([] as File[]);
    const packageService = {
      extractAssets,
      processPackage: vi.fn().mockResolvedValue({
        cid: "bafy-built-dossier",
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
    const fetchFn = vi.fn(async (resource: string) => {
      const bytes = await readFile(fileURLToPath(resource));
      return new Response(new Blob([bytes], { type: "application/zip" }), {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/zip" },
      });
    });

    const result = await builtBuilder.prepareDossier({
      name: "Dossier",
      description: "A living file dossier",
      packageService,
      fetchFn,
    });

    expect(BUILT_INDEX_PATH).toMatch(/packages\/builder\/dist\/builder\/src\/index\.js$/);
    expect(BUILT_TYPES_PATH).toMatch(/packages\/builder\/dist\/builder\/src\/index\.d\.ts$/);
    expect(bundlePath).toMatch(/packages\/builder\/dist\/builder\/src\/dossier\.zip$/);
    expect(fetchFn).toHaveBeenCalledWith(builtBuilder.DOSSIER_BUNDLE_URL);
    expect(extractAssets).toHaveBeenCalledWith(expect.any(File));
    expect(packageService.processPackage).toHaveBeenCalledWith([]);
    expect(result.packageCid).toBe("bafy-built-dossier");
  }, 30000);

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
