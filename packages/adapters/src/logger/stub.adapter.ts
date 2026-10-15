import type { LoggerAdapter } from '@platform/core/interfaces';

/** Captures log lines into an array — for tests and local dev. */
export class StubLoggerAdapter implements LoggerAdapter {
  readonly provider = 'stub';
  public lines: { level: string; message: string; context?: Record<string, unknown> }[] = [];

  debug(message: string, context?: Record<string, unknown>): void {
    this.lines.push({ level: 'debug', message, context });
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.lines.push({ level: 'info', message, context });
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.lines.push({ level: 'warn', message, context });
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.lines.push({ level: 'error', message, context });
  }

  child(context: Record<string, unknown>): LoggerAdapter {
    // Arrow functions capture `this` lexically — no `this` aliasing.
    const make = (extra: Record<string, unknown>): LoggerAdapter => {
      const merged = { ...context, ...extra };
      return {
        provider: 'stub',
        debug: (m: string, c?: Record<string, unknown>) => this.debug(m, { ...merged, ...c }),
        info: (m: string, c?: Record<string, unknown>) => this.info(m, { ...merged, ...c }),
        warn: (m: string, c?: Record<string, unknown>) => this.warn(m, { ...merged, ...c }),
        error: (m: string, c?: Record<string, unknown>) => this.error(m, { ...merged, ...c }),
        child: (c: Record<string, unknown>) => make(c),
      } as LoggerAdapter;
    };
    return make({});
  }
}
