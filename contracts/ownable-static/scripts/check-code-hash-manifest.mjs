import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(
  "contracts/ownable-static/artifacts/code-hash-manifest.json"
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (!manifest.codeHash || !/^0x[0-9a-fA-F]{64}$/.test(manifest.codeHash)) {
  throw new Error(
    `Invalid code hash manifest at ${manifestPath}: expected 0x-prefixed 64-byte hash`
  );
}

if (!manifest.generatedAt) {
  throw new Error(`Missing generatedAt in ${manifestPath}`);
}

console.log("code-hash manifest is valid");
