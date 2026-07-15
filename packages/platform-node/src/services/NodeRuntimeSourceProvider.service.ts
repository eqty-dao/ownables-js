import type { RuntimeSourceProvider } from "@ownables/core";

export class NodeRuntimeSourceProvider implements RuntimeSourceProvider {
  constructor(private readonly workerSource = "") {}
  getWorkerSource(): string { return this.workerSource; }
}
