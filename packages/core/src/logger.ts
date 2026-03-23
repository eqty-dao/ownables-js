export type LoggerLike = Pick<Console, "debug" | "info" | "warn" | "error">;

export type ConsolaLike = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export const consoleLogger: LoggerLike = console;

export const createConsolaLogger = (consola: ConsolaLike): LoggerLike => ({
  debug: (...args: unknown[]) => consola.debug(...args),
  info: (...args: unknown[]) => consola.info(...args),
  warn: (...args: unknown[]) => consola.warn(...args),
  error: (...args: unknown[]) => consola.error(...args),
});
