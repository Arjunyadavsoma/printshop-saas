/** Base class for all platform errors — carries a stable `code` for clients. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** The caller supplied data that failed Zod / domain validation. */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

/** A resource wasn't found. */
export class NotFoundError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, context);
  }
}

/** The caller is authenticated but lacks the role / tenant scope. */
export class ForbiddenError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, context);
  }
}

/** No authenticated principal, or token expired. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

/** A rate-limit was hit. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 'RATE_LIMITED', 429);
  }
}

/** An external adapter call failed. */
export class AdapterError extends AppError {
  constructor(provider: string, message: string, context?: Record<string, unknown>) {
    super(`[${provider}] ${message}`, 'ADAPTER_ERROR', 502, { provider, ...context });
  }
}
