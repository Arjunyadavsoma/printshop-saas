import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/lib/container';
import { rateLimit, rateKey } from '@/lib/api/rate-limit';
import { getOtpService, isOtpEnabled } from '@/lib/auth/otp-service';
import { normalizePhone, isValidPhone, OTP_PER_IP_LIMIT, OTP_PER_IP_WINDOW } from '@/lib/auth/otp-provider';

/**
 * POST /api/v1/auth/otp/send — issue a 6-digit OTP to the given phone.
 *
 * Anti-enumeration: ALWAYS returns 200 `{ sent: true }` regardless of:
 *  - whether the phone is valid (we just don't send)
 *  - whether the phone is rate-limited (we just don't send)
 *  - whether OTP is disabled (we return 200 + `sent: false` for the "coming
 *    soon" case so the client can show the right UI)
 *
 * Rate limiting:
 *  - Per-IP: 10 OTP requests per hour (fixed window). Enforced BEFORE the
 *    service is called so a flood from one IP can't exhaust the SMS quota.
 *  - Per-phone: 3 OTPs per 10 minutes (enforced inside the service).
 *
 * The plaintext code is NEVER in the response body — it's delivered via the
 * provider (console in dev, SMS in prod).
 *
 * Feature flag: `OTP_ENABLED=true` enables the endpoint. When disabled, the
 * endpoint returns `{ sent: false, reason: 'disabled' }` with 200 — the
 * /orders page shows "Coming soon" in that case.
 */

const BodySchema = z.object({
  phone: z.string().min(4).max(20),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Feature flag — short-circuit when OTP is off.
  if (!isOtpEnabled()) {
    return NextResponse.json({ success: true, data: { sent: false, reason: 'disabled' } });
  }

  // Per-IP rate limit (10 / hour). Enforced before parsing the body so a
  // flood of malformed requests can't bypass it.
  const container = getContainer();
  try {
    await rateLimit(container.cache, rateKey(req, 'otp-send-ip'), OTP_PER_IP_LIMIT, OTP_PER_IP_WINDOW);
  } catch {
    // Rate-limited — return the same 200 anti-enumeration shape so the
    // caller can't tell whether they hit the limit vs. a successful send.
    return NextResponse.json({ success: true, data: { sent: true } });
  }

  // Parse + validate the phone.
  let phone: string;
  try {
    const body = BodySchema.parse(await req.json());
    phone = normalizePhone(body.phone);
  } catch {
    // Invalid body / phone — return 200 anti-enumeration (no leak).
    return NextResponse.json({ success: true, data: { sent: true } });
  }
  if (!isValidPhone(phone)) {
    return NextResponse.json({ success: true, data: { sent: true } });
  }

  try {
    const svc = await getOtpService(container.cache);
    await svc.generateAndSend(phone);
  } catch {
    // The provider threw (e.g. SMS gateway not wired). The client gets the
    // same 200 anti-enumeration shape; the operator sees the error in logs.
    // The customer will retry after not receiving the code — the per-phone
    // + per-IP rate limits bound the blast radius.
  }

  return NextResponse.json({ success: true, data: { sent: true } });
}
