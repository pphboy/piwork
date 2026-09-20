/**
 * Structured logs go to stderr so stdout stays reserved for data (streamed
 * answers, JSON output). Line format: "<iso> LEVEL message {json fields}".
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_NAMES = Object.keys(LEVEL_WEIGHT) as LogLevel[];

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return LEVEL_NAMES.includes(value as LogLevel);
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  return isLogLevel(normalized) ? normalized : fallback;
}

export function createLogger(level: LogLevel, stream: NodeJS.WritableStream = process.stderr): Logger {
  const threshold = LEVEL_WEIGHT[level];

  const write = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return;
    const suffix = fields === undefined || Object.keys(fields).length === 0 ? "" : ` ${JSON.stringify(fields)}`;
    stream.write(`${new Date().toISOString()} ${entryLevel.toUpperCase()} ${message}${suffix}\n`);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
