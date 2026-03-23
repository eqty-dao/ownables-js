import { describe, expect, it, vi } from "vitest";

import { consoleLogger, createConsolaLogger } from "../src/logger";

describe("logger", () => {
  it("exposes console logger by default", () => {
    expect(consoleLogger).toBe(console);
  });

  it("adapts a consola-like logger to LoggerLike", () => {
    const consola = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const logger = createConsolaLogger(consola);
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(consola.debug).toHaveBeenCalledWith("d");
    expect(consola.info).toHaveBeenCalledWith("i");
    expect(consola.warn).toHaveBeenCalledWith("w");
    expect(consola.error).toHaveBeenCalledWith("e");
  });
});
