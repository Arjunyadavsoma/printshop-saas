import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import {
  hasSupportEmail,
  hasSupportWhatsApp,
  supportMailto,
  supportWhatsAppLink,
} from '@/lib/customer/support-config';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Reach the Printelyx team, or contact the print shop directly from your order tracking page.',
  alternates: { canonical: '/contact' },
};

/** /contact — real contact routes; controls hidden when not configured. */
export default function ContactPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">Contact</h1>
        <p className="mt-4 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Questions about an order — status, payment verification, or file changes — are best
          answered by the shop itself. Open the tracking link from your receipt and use the Call
          shop button there.
        </p>

        <div className="mt-6 rounded-[14px] bg-white p-4">
          <Link
            href="/orders"
            className="flex items-center gap-2 min-h-[48px] text-[15px] font-medium text-[var(--label)]"
          >
            <Phone className="size-4" aria-hidden="true" />
            Find my order and call the shop
          </Link>
        </div>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">Reach the Printelyx team</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          For problems with the app itself — a payment that will not verify, a file that will not
          upload — report it and include your order token if you have one.
        </p>
        <div className="mt-4 space-y-3">
          {hasSupportEmail() && (
            <a
              href={supportMailto('Printelyx support request')}
              className="flex items-center gap-2 min-h-[48px] rounded-[14px] bg-white px-4 text-[15px] font-medium text-[var(--label)]"
            >
              <Mail className="size-4" aria-hidden="true" />
              Email support
            </a>
          )}
          {hasSupportWhatsApp() && (
            <a
              href={supportWhatsAppLink('Hello Printelyx support')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 min-h-[48px] rounded-[14px] bg-white px-4 text-[15px] font-medium text-[var(--label)]"
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              WhatsApp support
            </a>
          )}
          {!hasSupportEmail() && !hasSupportWhatsApp() && (
            <p className="text-[15px] text-[var(--label-2)]">
              In-app support is being set up. For now, ask the shop directly — the tracking page
              has a Call shop button, and the <Link href="/help" className="text-[var(--accent)] underline">Help</Link> page
              answers the most common questions.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
