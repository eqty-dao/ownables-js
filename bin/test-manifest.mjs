import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";

const pkg = process.argv[2]?.trim();

if (!pkg) {
  throw new Error("Usage: yarn test:manifest <pkg>");
}

if (!/^[a-zA-Z0-9_-]+$/.test(pkg)) {
  throw new Error(`Invalid package name: ${pkg}`);
}

const baseDir = resolve("ownables", pkg);
const manifestPath = resolve(baseDir, "artifacts", "code-hash-manifest.json");
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
  const artifactPath = resolve(baseDir, "artifacts", manifest.artifact);
  if (existsSync(artifactPath)) {
    const artifact = readFileSync(artifactPath);
    const actualCodeHash = `0x${createHash("sha256").update(artifact).digest("hex")}`;

    if (actualCodeHash.toLowerCase() !== String(manifest.codeHash).toLowerCase()) {
      throw new Error(
        `Code hash mismatch for ${pkg}: manifest=${manifest.codeHash}, actual=${actualCodeHash}`
      );
    }
  }
}

if (pkg === "dossier") {
  const zipPath = resolve("ownables", `${pkg}.zip`);
  if (!existsSync(zipPath)) {
    throw new Error(`Missing built package zip for ${pkg}: ${zipPath}`);
  }

  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const files = Object.keys(zip.files);
  if (files.includes("index.html")) {
    throw new Error("Dossier package must not include index.html");
  }

  const querySchemaText = await zip.file("query_msg.json")?.async("string");
  const executeSchemaText = await zip.file("execute_msg.json")?.async("string");

  if (!querySchemaText || !executeSchemaText) {
    throw new Error("Dossier package zip must include query_msg.json and execute_msg.json");
  }

  const querySchema = JSON.parse(querySchemaText);
  const executeSchema = JSON.parse(executeSchemaText);
  const includesRequired = (schema, method) =>
    Array.isArray(schema.oneOf) &&
    schema.oneOf.some((entry) => Array.isArray(entry.required) && entry.required.includes(method));

  if (includesRequired(querySchema, "get_widget_state")) {
    throw new Error("Dossier query schema must not expose get_widget_state");
  }

  for (const method of ["get_attachments", "is_closed"]) {
    if (!includesRequired(querySchema, method)) {
      throw new Error(`Dossier query schema must expose ${method}`);
    }
  }

  for (const method of ["attach", "close"]) {
    if (!includesRequired(executeSchema, method)) {
      throw new Error(`Dossier execute schema must expose ${method}`);
    }
  }
}

if (pkg === "dossier") {
  const zipPath = resolve("ownables", `${pkg}.zip`);
  const zipListing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (zipListing.some((entry) => entry.endsWith("index.html"))) {
    throw new Error(`Dossier package must omit index.html, but ${zipPath} still contains it`);
  }

  const querySchemaPath = resolve(baseDir, "schema", "query_msg.json");
  const executeSchemaPath = resolve(baseDir, "schema", "execute_msg.json");
  const querySchema = JSON.parse(readFileSync(querySchemaPath, "utf8"));
  const executeSchema = JSON.parse(readFileSync(executeSchemaPath, "utf8"));
  const queryMethods = querySchema.oneOf?.flatMap((entry) => entry.required ?? []) ?? [];
  const executeMethods = executeSchema.oneOf?.flatMap((entry) => entry.required ?? []) ?? [];

  for (const method of ["get_attachments", "is_closed"]) {
    if (!queryMethods.includes(method)) {
      throw new Error(`Dossier query schema is missing ${method}`);
    }
  }

  for (const method of ["attach", "close"]) {
    if (!executeMethods.includes(method)) {
      throw new Error(`Dossier execute schema is missing ${method}`);
    }
  }

  if (queryMethods.includes("get_widget_state")) {
    throw new Error("Dossier query schema must not expose get_widget_state");
  }
}

console.log(`manifest is valid for ${pkg}`);
