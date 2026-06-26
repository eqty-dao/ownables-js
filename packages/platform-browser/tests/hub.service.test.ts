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
