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
    return new AppError(cause.message, 'INTERNAL_ERROR', 500);
  }
  return new AppError('Unknown error', 'INTERNAL_ERROR', 500);
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

export {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  AdapterError,
};
