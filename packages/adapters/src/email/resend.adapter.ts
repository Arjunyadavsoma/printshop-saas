import { Resend } from 'resend';
import type { EmailAdapter, EmailMessage } from '@platform/core/interfaces';

/**
 * Resend email adapter (Resend free tier: 3,000 emails/month).
 *
 * The production email sender for Printelyx. Wired in the container
 * (`src/lib/container.ts`) when `EMAIL_PROVIDER=resend` and
 * `RESEND_API_KEY` is set; otherwise the container keeps the
 * `StubEmailAdapter` (dev/tests) — so a deploy without the key still
 * boots and the password-reset route keeps returning success
 * (anti-enumeration), it just can't deliver mail yet.
 *
 * The sender address comes from the caller (`EMAIL_FROM` env in the
 * forgot-password route). It must be a sender verified in the Resend
 * dashboard — for printelyx.cc.cd that means the domain is verified
 * there (DNS TXT records) and `EMAIL_FROM` is an address on it, e.g.
 * `no-reply@printelyx.cc.cd`. Until the domain is verified, use
 * Resend's `onboarding@resend.dev` sender (delivers only to the
 * account owner's email) or leave the key unset.
 */
export class ResendEmailAdapter implements EmailAdapter {
  readonly provider = 'resend';
  private readonly client: Resend;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('ResendEmailAdapter requires a RESEND_API_KEY');
    }
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const { data, error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
    });
    if (error) {
      // Resend returns errors as values, not throws — surface them so the
      // caller (and Vercel logs) see a real failure instead of silence.
      throw new Error(`Resend send failed: ${error.message}`);
    }
    return { messageId: data?.id ?? '' };
  }
}
