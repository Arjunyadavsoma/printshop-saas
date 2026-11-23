import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { getOtpService, isOtpEnabled } from '@/lib/auth/otp-service';
import { normalizePhone, isValidPhone } from '@/lib/auth/otp-provider';

/**
 * POST /api/v1/auth/otp/verify — verify a 6-digit OTP against the stored hash.
 *
 * Returns `{ valid: boolean, attemptsRemaining: number }`:
 *  - `valid: true` → the code matched (and was consumed — replay prevented).
 *  - `valid: false, attemptsRemaining: N` → wrong code, N tries left.
 *  - `valid: false, attemptsRemaining: 0` → locked out (5 wrong guesses).
 *  - `valid: false, attemptsRemaining: 5` → no code issued OR code expired
 *    (same shape as a fresh code — anti-enumeration).
 *
 * Rate limited per-IP (60 / hour) — a brute-force attack would need 60
 * guesses per IP per hour, and the 5-attempt lockout kicks in long before
 * that on any single phone.
 *
 * Feature flag: when `OTP_ENABLED !== true`, returns `{ valid: false }`
 * without touching the cache.
 */

const BodySchema = z.object({
  phone: z.string().min(4).max(20),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isOtpEnabled()) {
    return NextResponse.json({ success: true, data: { valid: false, attemptsRemaining: 0, reason: 'disabled' } });
  }

  const container = getContainer();
  // Per-IP rate limit on verify (60 / hour) — a brute-force attacker can't
  // exceed this without rotating IPs, and the per-phone 5-attempt lockout
  // is the authoritative guard regardless.
  try {
    await rateLimit(container.cache, rateKey(req, 'otp-verify-ip'), 60, 3600);
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
      { status: 429 },
    );
  }

  let phone: string;
  let code: string;
  try {
    const body = BodySchema.parse(await req.json());
    phone = normalizePhone(body.phone);
    code = body.code;
  } catch {
    return NextResponse.json({ success: true, data: { valid: false, attemptsRemaining: 5 } });
  }
  if (!isValidPhone(phone)) {
    return NextResponse.json({ success: true, data: { valid: false, attemptsRemaining: 5 } });
  }

  try {
    const svc = await getOtpService(container.cache);
    const result = await svc.verify(phone, code);
    return NextResponse.json({ success: true, data: result });
  } catch {
    // Cache error — return the anti-enumeration shape.
    return NextResponse.json({ success: true, data: { valid: false, attemptsRemaining: 5 } });
  }
}
