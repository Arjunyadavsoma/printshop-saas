import type { LoggerAdapter } from '@platform/core/interfaces';

/**
 * Structured JSON logger to stdout (pino-compatible shape) so downstream
 * aggregators (Axiom/Logtail) can ingest directly. This is the production
 * concrete for the {@link LoggerAdapter} interface; the stub concrete in
 * packages/adapters is for tests.
 */
export class JsonConsoleLogger implements LoggerAdapter {
  readonly provider = 'json';
  constructor(private base: Record<string, unknown> = {}) {}

  private write(level: string, message: string, context?: Record<string, unknown>): void {
    const line = {
      level,
      message,
      time: Date.now(),
      ...this.base,
      ...(context ?? {}),
    };
    console.log(JSON.stringify(line));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === 'debug') this.write('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }

  child(context: Record<string, unknown>): LoggerAdapter {
    return new JsonConsoleLogger({ ...this.base, ...context });
  }
}
