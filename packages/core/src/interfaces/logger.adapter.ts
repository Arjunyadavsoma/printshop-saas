/**
 * Structured-logging abstraction. Every layer logs through this — the
 * concrete implementation is selected at boot via `LOGGER_PROVIDER`.
 *
 * Concrete implementations:
 *  - `PinoLoggerAdapter`    (JSON to stdout, request-id propagation)
 *  - `SentryLoggerAdapter`  (errors → Sentry, rest → pino)
 *  - `StubLoggerAdapter`     (tests — captures to memory)
 *
 * All methods accept a structured context object as the second argument so
 * logs remain queryable downstream (Axiom / Logtail).
 */
export interface LoggerAdapter {
  readonly provider: string;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /** Attach a child logger with permanent context (e.g. { requestId }). */
  child(context: Record<string, unknown>): LoggerAdapter;
}
