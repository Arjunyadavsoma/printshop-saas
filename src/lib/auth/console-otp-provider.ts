/**
 * ConsoleOtpProvider — dev-only OTP transport that logs the code to stdout.
 *
 * Selected by `OTP_PROVIDER=console` (the default). Use this for local dev
 * + integration tests — the code appears in the terminal, no SMS gateway
 * needed. NEVER use in production: the code is written to logs, which are
 * often shipped to a log aggregator (Axiom/Logtail) where anyone with read
 * access could harvest OTPs.
 *
 * The log line format is the one the test harness greps for:
 *   [OTP] 9876543210 → 123456 (5 min TTL)
 */

import type { OtpProvider } from './otp-provider';
import { OTP_TTL_SECONDS } from './otp-provider';

export class ConsoleOtpProvider implements OtpProvider {
  readonly provider = 'console';

  async send(phone: string, code: string): Promise<void> {
    // IMPORTANT: the code is logged here in DEV ONLY. This is the single
    // place the plaintext code is emitted beyond the `crypto.randomInt`
    // call in the service. Production uses the SMS provider, which sends
    // the code over the SMS gateway (also plaintext, but to the customer's
    // handset — not to a shared log aggregator).
    const ttlMin = Math.round(OTP_TTL_SECONDS / 60);
    // Use console.log (not console.error) so the line is easy to grep in
    // dev logs; structured loggers would JSON-encode it + make the code
    // harder to read at a glance during local testing.
    console.log(`[OTP] ${phone} → ${code} (${ttlMin} min TTL)`);
  }
}
