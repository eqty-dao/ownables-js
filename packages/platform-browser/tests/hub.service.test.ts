import { describe, expect, it, vi } from "vitest";

import HubService, {
  AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE,
} from "../src/services/Hub.service";

describe("HubService", () => {
  const ACCOUNT = "0xabc";

  it("uses the ownables-scoped discovery route", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ owner: ACCOUNT, entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const hub = new HubService("https://hub.example", fetchFn);

    await hub.listAvailableOwnables(ACCOUNT);

    expect(fetchFn).toHaveBeenCalledWith(
      `https://hub.example/ownables/available?owner=${encodeURIComponent(ACCOUNT)}`
    );
  });

  it("guards Hub imports to the configured origin", () => {
    const hub = new HubService("https://hub.example");

    expect(() => hub.parseHubDownloadUrl(hub.getPackageDownloadUrl("bafy-1"))).not.toThrow();
    expect(() =>
      hub.parseHubDownloadUrl("https://evil.example/ownables/bafy/download")
    ).toThrow("Hub download URL must use the configured Hub origin");
    expect(() => hub.parseHubDownloadUrl("not-a-url")).toThrow(
      "Hub download URL is malformed"
    );
  });

  it("maps missing discovery endpoints to the accepted unavailable message", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(null, { status: 404, statusText: "Not Found" })
    );
    const hub = new HubService("https://hub.example", fetchFn);

    await expect(hub.listAvailableOwnables(ACCOUNT)).rejects.toThrow(
      AVAILABLE_OWNABLES_UNAVAILABLE_MESSAGE
    );
  });

  it("probes hub availability through the health endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"));

    const hub = new HubService("https://hub.example", fetchFn);

    await expect(hub.isAvailable()).resolves.toBe(true);
    await expect(hub.isAvailable()).resolves.toBe(false);
    expect(fetchFn).toHaveBeenNthCalledWith(1, "https://hub.example/health", { method: "GET" });
    expect(fetchFn).toHaveBeenNthCalledWith(2, "https://hub.example/health", { method: "GET" });
  });

  it("uploads ownables to the Hub upload endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ cid: "bafy-uploaded", owner: ACCOUNT }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const hub = new HubService("https://hub.example", fetchFn);

    const result = await hub.uploadOwnable(new Uint8Array([1, 2, 3]), "dossier.zip");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://hub.example/ownables/upload");
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);

    const uploadedFile = (fetchFn.mock.calls[0]?.[1]?.body as FormData).get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).name).toBe("dossier.zip");
    expect(result).toEqual({ cid: "bafy-uploaded", owner: ACCOUNT });
  });

  it("downloads ownables from the Hub package endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(new Blob(["zip-bytes"], { type: "application/zip" }), {
        status: 200,
        headers: { "content-type": "application/zip" },
      })
    );
    const hub = new HubService("https://hub.example", fetchFn);

    const result = await hub.downloadOwnable("bafy-download");

    expect(fetchFn).toHaveBeenCalledWith("https://hub.example/packages/bafy-download/download");
    expect(result.name).toBe("bafy-download.zip");
    expect(result.type).toBe("application/zip");
  });

  it("imports package and chain payloads from Hub", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["zip-bytes"], { type: "application/zip" }), {
          status: 200,
          headers: { "content-type": "application/zip" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "ownable-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    const hub = new HubService("https://hub.example", fetchFn);

    const result = await hub.importFromHub("bafy-1", "ownable-1");

    expect(fetchFn).toHaveBeenNthCalledWith(1, "https://hub.example/packages/bafy-1/download");
    expect(fetchFn).toHaveBeenNthCalledWith(2, "https://hub.example/ownables/ownable-1/chain");
    expect(result.packageFile.name).toBe("download.zip");
    expect(result.chainJson).toEqual({ id: "ownable-1" });
  });
});
