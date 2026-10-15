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

/** Convert any thrown value to an AppError so the envelope is consistent. */
export function toAppError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  if (cause instanceof ZodError) {
    return new ValidationError('Invalid request', { issues: cause.issues });
  }
  if (cause instanceof Error) {
    captureSentry(cause); // spec §11: error tracking
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
