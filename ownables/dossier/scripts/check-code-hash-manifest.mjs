import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(rootDir, "artifacts", "code-hash-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (!manifest.codeHash || !/^0x[0-9a-fA-F]{64}$/.test(manifest.codeHash)) {
  throw new Error(
    `Invalid code hash manifest at ${manifestPath}: expected 0x-prefixed 64-byte hash`
  );
}

if (!manifest.generatedAt) {
  throw new Error(`Missing generatedAt in ${manifestPath}`);
}

if (manifest.artifact && typeof manifest.artifact !== "string") {
  throw new Error(`Invalid artifact in ${manifestPath}: expected string`);
}

if (typeof manifest.artifact === "string") {
  const artifactPath = resolve(rootDir, "artifacts", manifest.artifact);
  if (existsSync(artifactPath)) {
    const artifact = readFileSync(artifactPath);
    const actualCodeHash = `0x${createHash("sha256").update(artifact).digest("hex")}`;

    if (actualCodeHash.toLowerCase() !== String(manifest.codeHash).toLowerCase()) {
      throw new Error(
        `Code hash mismatch: manifest=${manifest.codeHash}, actual=${actualCodeHash}`
      );
    }
  }
}

console.log("code-hash manifest is valid");
