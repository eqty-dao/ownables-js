import { calculateOwnablePackageCid } from "@ownables/core";
import type { CidCalculator } from "../types/PlatformNode";

export class OwnablePackageCidCalculator implements CidCalculator {
  async calculate(files: Map<string, Uint8Array>): Promise<string> {
    return calculateOwnablePackageCid(
      Array.from(files.entries()).map(([path, content]) => ({ path, content }))
    );
  }
}
