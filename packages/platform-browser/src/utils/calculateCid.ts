import { calculateOwnablePackageCid } from "@ownables/core";

export default async function calculateCid(files: File[]): Promise<string> {
  return calculateOwnablePackageCid(
    await Promise.all(
      files.map(async (file) => ({
        path: file.name,
        content: new Uint8Array(await file.arrayBuffer()),
      }))
    )
  );
}
