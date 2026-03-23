import { describe, expect, it } from "vitest";

import { consoleLogger } from "../src/logger";

describe("logger", () => {
  it("exposes console logger by default", () => {
    expect(consoleLogger).toBe(console);
  });
});
