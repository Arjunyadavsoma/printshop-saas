/**
 * Default {@link OtpService} implementation (P8.6).
 *
 * Storage: the {@link CacheAdapter} (Redis in prod, in-memory in dev). The
 * code is NEVER stored in plaintext — only its SHA-256 hash + the attempt
 * counter + the expiry timestamp live in the cache, under key `otp:<phone>`.
 *
 * The provider (console / SMS) is selected at module load time from
 * `OTP_PROVIDER` (default `console`). The provider is the ONLY place the
 * plaintext code exists beyond the single `crypto.randomInt` call.
 *
 * Anti-enumeration: every public method returns the same shape regardless of
 * whether a code was issued for the phone. `verify` returns
 * `{ valid: false, attemptsRemaining: OTP_MAX_ATTEMPTS }` for an unknown
 * phone (so the UI shows "5 attempts left" — the same as a fresh code).
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { CacheAdapter } from '@platform/core/interfaces';
import {
  type OtpProvider,
  type OtpService,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_PER_PHONE_WINDOW,
  OTP_PER_PHONE_LIMIT,
} from './otp-provider';

/** Cache key for the per-phone OTP record. */
function otpKey(phone: string): string {
  return `otp:${phone}`;
}

/** Cache key for the per-phone send-count window (rate limiting). */
function phoneWindowKey(phone: string): string {
  return `otp:window:phone:${phone}`;
}

/** Cache key for the last-send timestamp (resend cooldown). */
function lastSentKey(phone: string): string {
  return `otp:lastsent:${phone}`;
}

/** The hashed record stored in the cache. */
interface OtpRecord {
  /** SHA-256 hex of the 6-digit code. */
  hash: string;
  /** Wrong-code attempts so far. */
  attempts: number;
  /** Epoch ms when the code expires. */
  expiresAt: number;
}

/** Parse a stored OTP record, or null if missing/malformed/expired. */
async function readRecord(cache: CacheAdapter, phone: string): Promise<OtpRecord | null> {
  const raw = await cache.get(otpKey(phone));
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as OtpRecord;
    if (typeof r.hash !== 'string' || typeof r.attempts !== 'number' || typeof r.expiresAt !== 'number') {
      return null;
    }
    // Expired records are treated as missing (so the caller can issue a new code).
    if (Date.now() >= r.expiresAt) return null;
    return r;
  } catch {
    return null;
  }
}

/** SHA-256 hex of the plaintext code. */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Constant-time comparison of two hex strings. Both are 64 chars (SHA-256
 * hex), so the lengths always match — `timingSafeEqual` doesn't throw.
 * If the lengths ever mismatch (corruption), returns false WITHOUT calling
 * `timingSafeEqual` (which would throw on unequal lengths).
 */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export class OtpServiceImpl implements OtpService {
  constructor(
    private readonly cache: CacheAdapter,
    private readonly provider: OtpProvider,
  ) {}

  async generateAndSend(phone: string): Promise<void> {
    // Resend cooldown: if a code was sent < 30s ago, refuse (no-op). The
    // client gets the same "we sent a code" response either way (anti-enumeration).
    const lastSent = await this.cache.get(lastSentKey(phone));
    if (lastSent) {
      const elapsed = Date.now() - Number(lastSent);
      if (elapsed < OTP_RESEND_COOLDOWN_SECONDS * 1000) return;
    }

    // Per-phone rate limit: max N OTPs per 10-minute window. The counter
    // is incremented atomically; the window is set on the first increment.
    const count = await this.cache.incr(phoneWindowKey(phone));
    if (count === 1) {
      try {
        await this.cache.expire(phoneWindowKey(phone), OTP_PER_PHONE_WINDOW);
      } catch {
        // If expiry can't be set, drop the counter (fail open — don't lock
        // the phone permanently on a transient cache error).
        await this.cache.del(phoneWindowKey(phone)).catch(() => {});
      }
    }
    if (count > OTP_PER_PHONE_LIMIT) return; // rate-limited — silent (anti-enumeration)

    // Generate the code + store its hash + send it.
    const code = String(randomInt(100000, 999999));
    const record: OtpRecord = {
      hash: hashCode(code),
      attempts: 0,
      expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
    };
    await this.cache.set(otpKey(phone), JSON.stringify(record), OTP_TTL_SECONDS);
    await this.cache.set(lastSentKey(phone), String(Date.now()), OTP_RESEND_COOLDOWN_SECONDS);

    // Send via the provider. If the provider throws, the code IS stored (so
    // a retry can verify it), but we re-throw so the caller knows delivery
    // failed. In dev (console provider) this never throws.
    await this.provider.send(phone, code);
  }

  async verify(phone: string, code: string): Promise<{ valid: boolean; attemptsRemaining: number }> {
    const record = await readRecord(this.cache, phone);

    // Anti-enumeration: an unknown / expired / locked-out phone returns the
    // same shape as a fresh code with all attempts remaining. The caller can't
    // tell whether a code was actually issued for this phone.
    if (!record) {
      return { valid: false, attemptsRemaining: OTP_MAX_ATTEMPTS };
    }
    // Already locked out (attempts exhausted) — treat as invalid, no further
    // decrement (so the count doesn't go negative + the UI stays at 0).
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return { valid: false, attemptsRemaining: 0 };
    }

    const provided = hashCode(code);
    const ok = safeEqualHex(provided, record.hash);
    if (ok) {
      // Success → consume the code (delete the record). A replay attempt
      // will hit the `!record` branch above + return the same "no code"
      // shape (anti-enumeration).
      await this.cache.del(otpKey(phone)).catch(() => {});
      return { valid: true, attemptsRemaining: OTP_MAX_ATTEMPTS };
    }

    // Wrong code → decrement attempts + persist. If this was the last
    // attempt, the next call will hit the lockout branch above.
    const nextAttempts = record.attempts + 1;
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts);
    const remainingTtl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
    await this.cache.set(
      otpKey(phone),
      JSON.stringify({ ...record, attempts: nextAttempts }),
      remainingTtl,
    );
    return { valid: false, attemptsRemaining: remaining };
  }

  async isRateLimited(phone: string): Promise<boolean> {
    // Read-only check — the rate-limit counter is incremented only on send.
    // We peek at the current count without bumping it.
    try {
      const v = await this.cache.get(phoneWindowKey(phone));
      return Number(v ?? 0) > OTP_PER_PHONE_LIMIT;
    } catch {
      return false;
    }
  }

  async attemptsRemaining(phone: string): Promise<number> {
    try {
      const r = await readRecord(this.cache, phone);
      if (!r) return OTP_MAX_ATTEMPTS;
      return Math.max(0, OTP_MAX_ATTEMPTS - r.attempts);
    } catch {
      return OTP_MAX_ATTEMPTS;
    }
  }
}

// ── Provider selection ──────────────────────────────────────────────────────
//
// The provider is chosen at module load time from `OTP_PROVIDER` so the API
// routes can import a singleton without re-reading the env on every call.
// Lazy import avoids pulling the SMS SDK into the dev bundle when not needed.

let _otpService: OtpService | null = null;

/**
 * Get the singleton OtpService. Constructed lazily; the cache comes from the
 * container and the provider is selected by `OTP_PROVIDER` (default `console`).
 */
export async function getOtpService(cache: CacheAdapter): Promise<OtpService> {
  if (_otpService) return _otpService;
  const providerName = process.env.OTP_PROVIDER ?? 'console';
  const provider: OtpProvider =
    providerName === 'sms' ? await loadSmsProvider() : await loadConsoleProvider();
  _otpService = new OtpServiceImpl(cache, provider);
  return _otpService;
}

/** Test-only: inject a custom service (e.g. with an in-memory provider). */
export function setOtpServiceForTesting(svc: OtpService | null): void {
  _otpService = svc;
}

async function loadConsoleProvider(): Promise<OtpProvider> {
  const { ConsoleOtpProvider } = await import('./console-otp-provider');
  return new ConsoleOtpProvider();
}

async function loadSmsProvider(): Promise<OtpProvider> {
  const { SmsOtpProvider } = await import('./sms-otp-provider');
  return new SmsOtpProvider();
}

/** True when the OTP feature flag is on (`OTP_ENABLED=true`). */
export function isOtpEnabled(): boolean {
  return process.env.OTP_ENABLED === 'true';
}
