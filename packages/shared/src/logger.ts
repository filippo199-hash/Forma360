/**
 * Structured logging via pino.
 *
 * JSON output in production (one line per event, parsed by Railway / any log
 * drain). Pretty, human-readable output in development.
 *
 * Ground rule #7: `console.*` is banned in application code. Use
 * `logger.info(...)` / `logger.error(...)` / etc. instead.
 *
 * Attach per-request / per-tenant context via child loggers so all events
 * from one request share the same request_id / tenant_id / user_id fields.
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CreateLoggerOptions {
  /** Emitted as the `service` field on every log line. */
  service: string;
  level?: LogLevel;
  /** "development" | "test" | "production". Controls pretty vs. JSON output. */
  nodeEnv?: 'development' | 'test' | 'production';
}

/**
 * Build a root logger. Call once per process (web server boot, worker
 * boot, script entry) and pass the instance down via DI — do not re-create
 * it per request.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const { service, level = 'info', nodeEnv = 'production' } = options;

  const baseOptions: LoggerOptions = {
    level,
    base: { service },
    // ISO timestamps are easier to grep and correlate with Sentry than
    // pino's default epoch millis.
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    // Redact anything that looks like a credential. The redaction runs on
    // the serialised log object, so nested fields are covered.
    redact: {
      paths: [
        'password',
        '*.password',
        '*.*.password',
        'accessToken',
        '*.accessToken',
        'refreshToken',
        '*.refreshToken',
        'authorization',
        '*.authorization',
        'cookie',
        '*.cookie',
      ],
      censor: '[redacted]',
    },
  };

  if (nodeEnv === 'production') {
    return pino(baseOptions);
  }

  // Pretty transport for dev + test. Not loaded in production to avoid a
  // worker_threads dependency in the Railway image.
  return pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  });
}
