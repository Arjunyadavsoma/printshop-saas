/**
 * SmsOtpProvider — production OTP transport via an SMS gateway.
 *
 * Selected by `OTP_PROVIDER=sms`. This is a STUB: the actual SMS gateway
 * (MSG91, Twilio, Gupshup, etc.) integration is left to the operator.
 *
 * Why a stub and not a real integration?
 *  - Real SMS in India requires DLT registration (TRAI's Distributed Ledger
 *    Technology platform) for every sender ID + template. A template
 *    registration costs ~₹1000 + takes 24-48h to approve. Without DLT, no
 *    Indian operator will deliver the message.
 *  - SMS costs money (~₹0.20-0.40 per message in India). A misconfigured
 *    stub that fires real SMS at the rate-limit ceiling (10/min/IP) would
 *    cost ~₹4/min — non-trivial for a hobby deployment.
 *  - The SMS SDK credentials (MSG91 auth key, Twilio SID+token) must NOT
 *    ship in the repo — they're env vars the operator configures.
 *
 * To wire a real gateway:
 *  1. Register on MSG91 / Twilio / Gupshup; get the credentials.
 *  2. Register a DLT template (e.g. "Your Printelyx verification code is
 *     {##OTP##}. Valid for 5 minutes. Do not share this code.").
 *  3. Set env: OTP_PROVIDER=sms, SMS_GATEWAY=msg91, MSG91_AUTH_KEY=…,
 *     MSG91_SENDER_ID=PRNTSH, MSGLT_TEMPLATE_ID=DLT-XXXX.
 *  4. Replace the stub body below with a real `fetch()` to the gateway's
 *     REST API. The plaintext `code` goes into the template variable —
 *     NEVER log it (it would land in log aggregators + leak to anyone with
 *     log read access).
 *
 * The stub throws so a production deploy with `OTP_PROVIDER=sms` but no
 * gateway wired fails LOUDLY (the customer sees "Could not send code")
 * rather than silently swallowing OTP requests. Dev defaults to the console
 * provider so this stub is only reached when the operator explicitly opts in.
 */

import type { OtpProvider } from './otp-provider';

export class SmsOtpProvider implements OtpProvider {
  readonly provider = 'sms';

  async send(phone: string, code: string): Promise<void> {
    // In dev / before the gateway is wired: throw so the misconfiguration
    // is visible. In production: replace with a real SMS API call.
    if (process.env.NODE_ENV !== 'production') {
      // Dev convenience: also log the code so a developer who set
      // OTP_PROVIDER=sms but hasn't wired a gateway can still see it.
      // The console provider is the better dev default — this branch only
      // fires when someone explicitly chose SMS in dev (probably to test
      // the production code path).
      console.log(`[OTP-sms-stub] ${phone} → ${code} (no gateway wired)`);
      throw new Error('SMS gateway not wired — set MSG91_AUTH_KEY + DLT template, or use OTP_PROVIDER=console for dev.');
    }
    // Production: the operator MUST replace this with a real gateway call.
    // Until then, throw so the failure is visible (the API returns 200 to
    // the client either way — anti-enumeration — but the operator sees the
    // error in server logs).
    throw new Error('SMS gateway not configured — wire MSG91/Twilio/Gupshup in src/lib/auth/sms-otp-provider.ts before enabling OTP in production.');
  }
}
