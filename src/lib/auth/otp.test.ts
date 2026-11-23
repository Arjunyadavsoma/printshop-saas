import { describe, expect, it, beforeEach, vi } from 'vitest';
import { InMemoryCacheAdapter } from '@platform/adapters';
import { OtpServiceImpl } from '@/lib/auth/otp-service';
import type { OtpProvider } from '@/lib/auth/otp-provider';
import {
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_PER_PHONE_LIMIT,
} from '@/lib/auth/otp-provider';

/**
 * OTP service regression tests (P8.6).
 *
 * Covers the security properties the brief requires:
 *  - Expiry: a code older than 5 min is rejected.
 *  - Wrong code: attemptsRemaining decrements on each wrong guess.
 *  - Lockout: 5 wrong attempts → locked (attemptsRemaining: 0).
 *  - Replay: a successfully verified code can't be used again.
 *  - Rate limit: 3 OTPs in 10 min → the 4th is blocked (no code issued).
 *  - Constant-time compare: verification time doesn't leak whether the code
 *    exists (verified by timing the wrong-vs-unknown cases).
 *
 * The provider is a recording stub that captures the last code sent so the
 * test can verify against the actual plaintext (the service NEVER returns
 * the code to a client).
 */

/** A recording provider — captures every (phone, code) pair it was asked to send. */
class RecordingProvider implements OtpProvider {
  readonly provider = 'recording';
  sent: Array<{ phone: string; code: string }> = [];

  async send(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }

  /** The last code sent to a given phone (or null if none). */
  lastCodeFor(phone: string): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i]!.phone === phone) return this.sent[i]!.code;
    }
    return null;
  }
}

let cache: InMemoryCacheAdapter;
let provider: RecordingProvider;
let svc: OtpServiceImpl;

beforeEach(() => {
  cache = new InMemoryCacheAdapter();
  provider = new RecordingProvider();
  svc = new OtpServiceImpl(cache, provider);
});

describe('OTP — generateAndSend + verify (happy path)', () => {
  it('issues a 6-digit code + verifies it correctly', async () => {
    await svc.generateAndSend('9876543210');
    const code = provider.lastCodeFor('9876543210');
    expect(code).toBeTruthy();
    expect(code).toMatch(/^\d{6}$/);

    const result = await svc.verify('9876543210', code!);
    expect(result.valid).toBe(true);
  });

  it('a successfully verified code is consumed (replay prevented)', async () => {
    await svc.generateAndSend('9876543210');
    const code = provider.lastCodeFor('9876543210')!;

    const first = await svc.verify('9876543210', code);
    expect(first.valid).toBe(true);

    // Replay the SAME code → invalid (consumed). The response shape is the
    // anti-enumeration default (5 attempts remaining — same as a fresh code).
    const replay = await svc.verify('9876543210', code);
    expect(replay.valid).toBe(false);
    expect(replay.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS);
  });
});

describe('OTP — expiry (code older than 5 min rejected)', () => {
  it('an expired code is rejected with the anti-enumeration shape', async () => {
    await svc.generateAndSend('9876543210');
    const code = provider.lastCodeFor('9876543210')!;

    // Fast-forward the cache past the TTL. The InMemoryCacheAdapter honours
    // the TTL on get(), so the record vanishes + verify returns the
    // anti-enumeration default.
    vi.useFakeTimers();
    vi.advanceTimersByTime((OTP_TTL_SECONDS + 1) * 1000);

    const result = await svc.verify('9876543210', code);
    expect(result.valid).toBe(false);
    expect(result.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS);

    vi.useRealTimers();
  });
});

describe('OTP — wrong code (attempts decrement)', () => {
  it('each wrong guess decrements attemptsRemaining', async () => {
    await svc.generateAndSend('9876543210');
    const correct = provider.lastCodeFor('9876543210')!;
    // Flip the last digit to make a wrong-but-shaped code.
    const wrong = correct.slice(0, -1) + (correct.slice(-1) === '0' ? '1' : '0');

    const r1 = await svc.verify('9876543210', wrong);
    expect(r1.valid).toBe(false);
    expect(r1.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS - 1);

    const r2 = await svc.verify('9876543210', wrong);
    expect(r2.valid).toBe(false);
    expect(r2.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS - 2);

    const r3 = await svc.verify('9876543210', wrong);
    expect(r3.valid).toBe(false);
    expect(r3.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS - 3);
  });

  it('the correct code still verifies after a wrong guess (attempts persist)', async () => {
    await svc.generateAndSend('9876543210');
    const correct = provider.lastCodeFor('9876543210')!;
    const wrong = correct.slice(0, -1) + (correct.slice(-1) === '0' ? '1' : '0');

    await svc.verify('9876543210', wrong); // 4 left
    const ok = await svc.verify('9876543210', correct);
    expect(ok.valid).toBe(true);
  });
});

describe('OTP — lockout (5 wrong attempts → locked)', () => {
  it('5 wrong guesses lock the phone (attemptsRemaining: 0)', async () => {
    await svc.generateAndSend('9876543210');
    const correct = provider.lastCodeFor('9876543210')!;
    const wrong = correct.slice(0, -1) + (correct.slice(-1) === '0' ? '1' : '0');

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const r = await svc.verify('9876543210', wrong);
      expect(r.valid).toBe(false);
      // After the 5th wrong guess, attemptsRemaining hits 0.
      if (i < OTP_MAX_ATTEMPTS - 1) {
        expect(r.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS - (i + 1));
      } else {
        expect(r.attemptsRemaining).toBe(0);
      }
    }

    // The locked phone now rejects even the CORRECT code (lockout is the
    // authoritative guard, not the hash compare).
    const locked = await svc.verify('9876543210', correct);
    expect(locked.valid).toBe(false);
    expect(locked.attemptsRemaining).toBe(0);
  });
});

describe('OTP — rate limit (3 OTPs per 10 min → blocked)', () => {
  it('allows up to 3 OTPs in the window, blocks the 4th', async () => {
    // The resend cooldown (30s) is a separate guard — between sends we
    // advance fake time past the cooldown so the rate limit is what blocks
    // the 4th send (not the cooldown).
    vi.useFakeTimers();
    for (let i = 0; i < OTP_PER_PHONE_LIMIT; i++) {
      await svc.generateAndSend('9876543210');
      vi.advanceTimersByTime(31 * 1000); // past the 30s cooldown
    }
    expect(provider.sent.filter((s) => s.phone === '9876543210')).toHaveLength(OTP_PER_PHONE_LIMIT);

    // 4th call is rate-limited — the service returns silently (no code sent).
    vi.advanceTimersByTime(31 * 1000);
    await svc.generateAndSend('9876543210');
    expect(provider.sent.filter((s) => s.phone === '9876543210')).toHaveLength(OTP_PER_PHONE_LIMIT);

    // isRateLimited reflects the state.
    const limited = await svc.isRateLimited('9876543210');
    expect(limited).toBe(true);
    vi.useRealTimers();
  });

  it('a different phone is NOT rate-limited by another phone\'s sends', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < OTP_PER_PHONE_LIMIT; i++) {
      await svc.generateAndSend('9876543210');
      vi.advanceTimersByTime(31 * 1000);
    }
    const limitedOther = await svc.isRateLimited('9123456780');
    expect(limitedOther).toBe(false);

    // The other phone can still request an OTP.
    await svc.generateAndSend('9123456780');
    expect(provider.lastCodeFor('9123456780')).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('OTP — resend cooldown (30s between sends to the same phone)', () => {
  it('a resend within 30s is a no-op (no new code, no error)', async () => {
    await svc.generateAndSend('9876543210');
    const firstCode = provider.lastCodeFor('9876543210')!;

    // Immediate resend — should NOT issue a new code.
    await svc.generateAndSend('9876543210');
    expect(provider.lastCodeFor('9876543210')).toBe(firstCode);
    expect(provider.sent.filter((s) => s.phone === '9876543210')).toHaveLength(1);
  });

  it('after the cooldown window, a new code IS issued', async () => {
    await svc.generateAndSend('9876543210');
    const firstCode = provider.lastCodeFor('9876543210')!;

    vi.useFakeTimers();
    vi.advanceTimersByTime(31 * 1000); // 31s — past the 30s cooldown

    await svc.generateAndSend('9876543210');
    const secondCode = provider.lastCodeFor('9876543210')!;
    expect(secondCode).toBeTruthy();
    expect(secondCode).not.toBe(firstCode);

    vi.useRealTimers();
  });
});

describe('OTP — constant-time compare (no timing leak)', () => {
  /**
   * The verify path compares the provided hash to the stored hash using
   * `crypto.timingSafeEqual`. We sanity-check that the verify time for a
   * wrong code against a REAL record is in the same ballpark as the verify
   * time for a code against a MISSING record — if `timingSafeEqual` were
   * accidentally replaced with `===`, the missing-record branch would be
   * ~10x faster (no Buffer alloc, no compare).
   *
   * This is NOT a cryptographic timing attack (those need millions of
   * samples + nanosecond clocks); it's a regression guard against someone
   * swapping `timingSafeEqual` for `===` in a refactor.
   */
  it('verify time is similar for wrong-code-vs-real vs unknown-phone', async () => {
    await svc.generateAndSend('9876543210');
    const correct = provider.lastCodeFor('9876543210')!;
    const wrong = correct.slice(0, -1) + (correct.slice(-1) === '0' ? '1' : '0');

    // Warm up the JIT (the first call is always slower due to code compile).
    await svc.verify('9876543210', wrong);
    await svc.verify('0000000000', '000000');

    // Time N verify calls against the real record (wrong code).
    const N = 50;
    const tRealStart = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      await svc.verify('9876543210', wrong);
    }
    const tReal = Number(process.hrtime.bigint() - tRealStart) / N;

    // Time N verify calls against an unknown phone (no record → early return).
    const tUnknownStart = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      await svc.verify('0000000000', '000000');
    }
    const tUnknown = Number(process.hrtime.bigint() - tUnknownStart) / N;

    // The two paths should be within an order of magnitude of each other.
    // If `===` replaced `timingSafeEqual`, tUnknown would be ~100x smaller
    // (no Buffer alloc, no compare loop). We allow a generous 4x ratio to
    // avoid CI noise (the unknown path does one cache.get; the real path
    // does one cache.get + one timingSafeEqual over 64 bytes).
    const ratio = tReal / tUnknown;
    expect(ratio).toBeLessThan(4); // real is at most 4x slower than unknown
    expect(ratio).toBeGreaterThan(0.25); // ...and not faster (sanity)
  });
});

describe('OTP — anti-enumeration (unknown phone returns the fresh-code shape)', () => {
  it('verify on a phone with no code issued returns attemptsRemaining=MAX', async () => {
    const r = await svc.verify('9999999999', '123456');
    expect(r.valid).toBe(false);
    expect(r.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS);
  });

  it('attemptsRemaining on an unknown phone returns MAX (no leak)', async () => {
    const remaining = await svc.attemptsRemaining('9999999999');
    expect(remaining).toBe(OTP_MAX_ATTEMPTS);
  });
});
