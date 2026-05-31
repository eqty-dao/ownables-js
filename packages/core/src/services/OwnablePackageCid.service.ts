import { BlackHoleBlockstore } from "blockstore-core";
import { importer } from "ipfs-unixfs-importer";

export interface OwnablePackageCidEntry {
  path: string;
  content: Uint8Array;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function includeForCid(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized !== "chain.json" && normalized !== "timestamp.txt";
}

export async function calculateOwnablePackageCid(entries: OwnablePackageCidEntry[]): Promise<string> {
  const filtered = entries
    .map((entry) => ({ path: normalizePath(entry.path), content: entry.content }))
    .filter((entry) => includeForCid(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({ path: `./package/${entry.path}`, content: entry.content }));

  const blockstore = new BlackHoleBlockstore();
  for await (const entry of importer(filtered, blockstore)) {
    if (entry.path === "package" && entry.unixfs?.type === "directory") {
      return entry.cid.toString();
    }
  }

  throw new Error(
    "Failed to calculate directory CID: importer did not find a directory entry in the input files"
  );
}
