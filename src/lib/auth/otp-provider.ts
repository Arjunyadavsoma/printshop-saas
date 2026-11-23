/**
 * OTP provider + service interfaces (P8.6).
 *
 * The OTP layer protects the cross-device "Look up by phone" + reorder flows
 * on `/orders`. It is OFF by default (env: `OTP_ENABLED=true`) — the default
 * order path stays on the unguessable 128-bit order token + device-local
 * recent-orders list. OTP is only consulted when a customer wants to pull
 * their order history from a DIFFERENT device using their phone number.
 *
 * Two abstractions:
 *  - {@link OtpProvider} — the transport (console for dev, SMS for prod).
 *    Selected by env: `OTP_PROVIDER=console|sms`.
 *  - {@link OtpService} — the orchestration: code generation, hashed storage,
 *    rate limiting, attempt counting, constant-time verification.
 *
 * Security properties (enforced by the default implementation):
 *  - 6-digit code via `crypto.randomInt(100000, 999999)` (uniform, not modulo-biased).
 *  - Stored hashed (SHA-256) in the cache; the plaintext code is NEVER logged
 *    or returned to the client.
 *  - 5-minute TTL.
 *  - 5 attempts max per phone (lockout after).
 *  - 30-second resend cooldown.
 *  - Per-phone rate limit: 3 OTPs per 10 minutes.
 *  - Per-IP rate limit: 10 OTP requests per hour.
 *  - Constant-time comparison (`crypto.timingSafeEqual`).
 *  - Send endpoint always returns 200 (anti-enumeration — no phone-existence leak).
 */

/**
 * The transport that delivers the OTP to the customer.
 * Implementations: ConsoleOtpProvider (dev), SmsOtpProvider (prod stub).
 */
export interface OtpProvider {
  readonly provider: string;
  /**
   * Send the OTP code to the given phone. The code is the plaintext — never
   * log it beyond this provider's own delivery channel.
   * @param phone E.164-ish phone (10-digit Indian mobile by default).
   * @param code The 6-digit plaintext code.
   */
  send(phone: string, code: string): Promise<void>;
}

/**
 * The OTP orchestration layer. The API routes call this; the provider is
 * injected so transport is swappable without touching the rate-limit /
 * verification logic.
 */
export interface OtpService {
  /** Generate a 6-digit code, store it hashed, and send it via the provider. */
  generateAndSend(phone: string): Promise<void>;

  /**
   * Verify a code against the stored hash. Constant-time compare. On success,
   * the code is consumed (one-shot — replay prevented). On failure, the
   * attempt counter decrements; when it hits 0, the phone is locked out
   * until the code expires + a new one is requested.
   * @returns `{ valid, attemptsRemaining }` — `attemptsRemaining` is surfaced
   *   so the UI can show "4 attempts left" without leaking whether the code
   *   existed (it returns the same count for "wrong code" and "no code issued").
   */
  verify(phone: string, code: string): Promise<{ valid: boolean; attemptsRemaining: number }>;

  /** True when the phone is rate-limited (too many OTPs requested recently). */
  isRateLimited(phone: string): Promise<boolean>;

  /** How many verification attempts remain before lockout. 0 when locked. */
  attemptsRemaining(phone: string): Promise<number>;
}

/** TTL + attempt constants (exported so tests can reference them). */
export const OTP_TTL_SECONDS = 5 * 60;             // 5-minute code lifetime
export const OTP_MAX_ATTEMPTS = 5;                 // 5 wrong guesses → lockout
export const OTP_RESEND_COOLDOWN_SECONDS = 30;     // 30s between sends
export const OTP_PER_PHONE_WINDOW = 10 * 60;       // 10-minute sliding window
export const OTP_PER_PHONE_LIMIT = 3;              // max 3 OTPs / 10 min / phone
export const OTP_PER_IP_LIMIT = 10;                // max 10 OTPs / hour / IP
export const OTP_PER_IP_WINDOW = 60 * 60;          // 1-hour sliding window

/** Normalise an Indian mobile number to 10 digits (strip +91, spaces, etc.). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  // Strip leading country code: 91 (India) or trailing 0.
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** True when the phone is a plausible 10-digit Indian mobile. */
export function isValidPhone(normalized: string): boolean {
  return /^[6-9]\d{9}$/.test(normalized);
}
