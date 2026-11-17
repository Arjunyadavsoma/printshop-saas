import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  AdapterError,
} from '@platform/core/errors';

/** Standard envelope for every API response: { success, data, error }. */
export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: Record<string, unknown>;
}

/** 200 with data. */
export function ok<T>(data: T, meta?: Record<string, unknown>): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) });
}

/** 201 created. */
export function created<T>(data: T): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

/** Error envelope from an AppError (preserves the stable code + status). */
export function fail(err: AppError): NextResponse<ApiEnvelope> {
  return NextResponse.json(
    {
      success: false,
      error: { code: err.code, message: err.message, ...(err.context ? { details: err.context } : {}) },
    },
    { status: err.statusCode },
  );
}

/**
 * Convert any thrown value to an AppError so the envelope is consistent.
 *
 * M8 fix: in PRODUCTION, non-`AppError` exceptions (i.e. NOT instances of
 * ValidationError / NotFoundError / ForbiddenError / etc.) get a generic
 * "Internal server error" message instead of the raw `cause.message`. The
 * raw message is captured to Sentry / server logs via `captureSentry` for
 * debugging — but it's NOT returned to the client, because:
 *   - Prisma errors can leak the database connection string (`Operations.js`
 *     throws with `error.message = "Can't reach database server at
 *     postgresql://user:pass@host:5432/db"`).
 *   - File-system errors can leak absolute paths (`ENOENT: no such file or
 *     directory, open '/var/app/secrets/api-key.json'`).
 *   - Internal stack traces can leak third-party SDK implementation details.
 *
 * `AppError` subclasses (ValidationError, NotFoundError, …) ALWAYS surface
 * their own `.message` because those messages are constructed by our own
 * code, are user-facing by design, and have been reviewed for leakage.
 *
 * In DEVELOPMENT (`NODE_ENV !== 'production'`), the raw `cause.message` is
 * returned for all errors — preserves the previous behaviour so developers
 * see the real error in the response body while debugging.
 *
 * The envelope's `code` field is always `INTERNAL_ERROR` (stable) and the
 * HTTP status is always 500 — for non-AppError exceptions. AppError
 * subclasses keep their own code + status.
 */
export function toAppError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  if (cause instanceof ZodError) {
    return new ValidationError('Invalid request', { issues: cause.issues });
  }
  if (cause instanceof Error) {
    // Always capture the real error for Sentry / server-side observability.
    captureSentry(cause); // spec §11: error tracking
    if (process.env.NODE_ENV === 'production') {
      // M8: don't leak the raw error message to the client. The
      // `requestId` header (set by `withAuth` / `timed` in with-auth.ts)
      // gives the operator a correlation key to find the real error in
      // logs / Sentry without exposing it to the caller.
      return new AppError(
        'Internal server error',
        'INTERNAL_ERROR',
        500,
      );
    }
    // Development: show the real error so the developer can debug.
    return new AppError(cause.message, 'INTERNAL_ERROR', 500);
  }
  return new AppError('Unknown error', 'INTERNAL_ERROR', 500);
}

/**
 * Sentry integration point. In production, replace this stub with
 * `import * as Sentry from '@sentry/node'; Sentry.init({ dsn: SENTRY_DSN })`
 * in the container, and `Sentry.captureException(err)` here. No-op without a
 * DSN — the architecture's error surface is the AppError → envelope path, so
 * wiring Sentry is a one-line swap.
 */
function captureSentry(err: Error): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // no-op in dev
  // Production: Sentry.captureException(err);
  // For the demo, log so the integration point is observable.
  try {
    console.error(JSON.stringify({ level: 'sentry', message: 'captured error', error: err.message, stack: err.stack?.slice(0, 200) }));
  } catch { /* swallow */ }
}

/** Convenience: run an async handler, envelope the result, normalise errors. */
export async function handle<T>(
  work: () => Promise<T>,
  opts?: { status?: 200 | 201; meta?: Record<string, unknown> },
): Promise<NextResponse<ApiEnvelope<T | unknown>>> {
  try {
    const data = await work();
    if (opts?.status === 201) return created(data);
    return ok(data, opts?.meta);
  } catch (cause) {
    return fail(toAppError(cause));
  }
}

/**
 * Structured request log (spec §11). Called by the auth/rate-limit wrappers on
 * every request completion. Generates (or honours) an X-Request-Id and logs
 * {method, path, status, durationMs, requestId} as JSON for log aggregation
 * (Axiom/Logtail). The id is also returned on the response header for
 * end-to-end traceability.
 */
export function requestId(req: { headers: Headers }): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

export function logRequest(
  logger: { info: (m: string, c?: Record<string, unknown>) => void },
  method: string,
  path: string,
  status: number,
  durationMs: number,
  rid: string,
): void {
  logger.info('request', { method, path, status, durationMs, requestId: rid });
}

export {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  AdapterError,
};
