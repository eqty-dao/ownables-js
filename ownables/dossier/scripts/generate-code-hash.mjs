import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const wasmPath = process.argv[2];
const outputPath = process.argv[3];

if (!wasmPath || !outputPath) {
  throw new Error("Usage: node scripts/generate-code-hash.mjs <wasmPath> <outputPath>");
}

const absoluteWasmPath = resolve(wasmPath);
const absoluteOutputPath = resolve(outputPath);
const wasm = readFileSync(absoluteWasmPath);
const sha256 = createHash("sha256").update(wasm).digest("hex");

const manifest = {
  contractName: "ownable-static",
  artifact: basename(absoluteWasmPath),
  algorithm: "sha256",
  codeHash: `0x${sha256}`,
  generatedAt: new Date().toISOString(),
};

writeFileSync(absoluteOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
