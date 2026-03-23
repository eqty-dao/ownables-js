export type LoggerLike = Pick<Console, "debug" | "info" | "warn" | "error">;

export const consoleLogger: LoggerLike = console;
