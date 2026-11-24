import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import {
  hasSupportEmail,
  hasSupportWhatsApp,
  supportMailto,
  supportWhatsAppLink,
} from '@/lib/customer/support-config';
import { InfoShell } from '../about/page';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Reach the Printelyx team, or contact the print shop directly from your order tracking page.',
  alternates: { canonical: '/contact' },
};

/**
 * /contact — real contact routes; controls hidden when not configured.
 *
 * White-on-white fix (diagnosis §4.1): every card/button now uses the theme
 * surface token bg-[var(--surface)] instead of hardcoded bg-white, so the
 * near-white dark-mode label text stays readable in both themes.
 *
 * Honesty rule: if no support channel is configured, the page says so
 * plainly and points at the one channel that always works — calling the
 * shop from the order tracking page — instead of promising a channel
 * that does not exist.
 */
export default function ContactPage() {
  const emailConfigured = hasSupportEmail();
  const whatsappConfigured = hasSupportWhatsApp();
  const anyChannel = emailConfigured || whatsappConfigured;

  return (
    <InfoShell>
      <h1 className="text-[28px] font-bold tracking-[-0.01em] text-[var(--label)]">Contact</h1>
      <p className="mt-2 text-[16px] leading-[1.6] text-[var(--label-2)]">
        Questions about an order — status, payment verification, or file changes — are best
        answered by the shop itself. Open your tracking page and use the Call shop button there.
      </p>

      <div className="mt-6 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        <Link
          href="/track"
          className="flex min-h-[56px] items-center justify-center gap-2 bg-[var(--accent)] px-4 text-[16px] font-semibold text-white"
        >
          <Phone className="size-4" aria-hidden="true" />
          Find my order
        </Link>
        <p className="border-t border-border px-4 py-3 text-[15px] leading-[1.5] text-[var(--label-2)]">
          Your tracking page has the shop&apos;s phone number and a Call shop button. That is the
          fastest way to reach someone about an order.
        </p>
      </div>

      <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">Reach the Printelyx team</h2>
      <p className="mt-2 text-[16px] leading-[1.6] text-[var(--label-2)]">
        For problems with the app itself — a payment that will not verify, a file that will not
        upload — report it and include your order token if you have one.
      </p>
      <div className="mt-4 space-y-3">
        {emailConfigured && (
          <a
            href={supportMailto('Printelyx support request')}
            className="flex min-h-[48px] items-center gap-2 rounded-[14px] bg-[var(--surface)] px-4 text-[15px] font-medium text-[var(--label)]"
          >
            <Mail className="size-4" aria-hidden="true" />
            Email support
          </a>
        )}
        {whatsappConfigured && (
          <a
            href={supportWhatsAppLink('Hello Printelyx support')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[48px] items-center gap-2 rounded-[14px] bg-[var(--surface)] px-4 text-[15px] font-medium text-[var(--label)]"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            WhatsApp support
          </a>
        )}
        {!anyChannel && (
          <div className="rounded-[14px] bg-[var(--surface)] px-4 py-4">
            <p className="text-[15px] leading-[1.6] text-[var(--label)]">
              Printelyx does not have a support email or WhatsApp number set up right now, so
              there is no inbox to write to yet.
            </p>
            <p className="mt-2 text-[15px] leading-[1.6] text-[var(--label-2)]">
              For anything about an order, call the shop from your tracking page — the shop can
              confirm payments, fix prints, and cancel orders. The{' '}
              <Link href="/help" className="text-[var(--accent)] underline">Help</Link> page
              answers the most common questions.
            </p>
          </div>
        )}
      </div>
    </InfoShell>
  );
}
