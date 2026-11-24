'use client';

import { useState, useId } from 'react';
import Link from 'next/link';
import { ChevronDown, Phone, Mail, MessageSquare } from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';
import {
  hasSupportEmail,
  hasSupportWhatsApp,
  supportMailto,
  supportWhatsAppLink,
} from '@/lib/customer/support-config';

/**
 * /help — Help + FAQ. A short list of 5–8 questions the customer is most
 * likely to ask, plus a "Contact shop" link and a "Report a problem" mailto
 * that pre-fills the order token from the URL query (when present).
 *
 * The accordion is a simple controlled button/region pair — no animation
 * library dependency. Each item animates its height via a CSS grid-row trick
 * (`grid-rows-[0fr]` → `grid-rows-[1fr]`) so the open/close is smooth and
 * the layout reserves space without measuring.
 */

interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'How do I pay?',
    a: 'Tap a UPI app (GPay, PhonePe, Paytm). After paying, enter the 12-digit UTR number from your payment receipt. The shop verifies it — Printelyx never touches your money.',
  },
  {
    q: 'When will my prints be ready?',
    a: 'Most orders are ready in 10–20 minutes. Check the tracking page for live status — you will see the step change from "Printing" to "Ready".',
  },
  {
    q: 'Is my payment safe?',
    a: 'You pay the shop directly via UPI. Printelyx does not handle your money — 0% commission, no middleman. We never see your card or UPI PIN.',
  },
  {
    q: 'Are my files private?',
    a: 'Yes. Files are deleted 24 hours after you pick up your prints. If you do not pick up within 7 days, files are deleted automatically. See the Privacy page for the full policy.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes, but only before printing starts. Tap "Cancel order" on the tracking page. Once printing has begun, the shop has already used paper and ink.',
  },
  {
    q: 'I paid but it says pending',
    a: 'The shop needs to verify your payment manually. Wait 1–2 minutes, or call the shop using the "Call shop" button on the tracking page. If the UTR was rejected, you can re-enter the correct one.',
  },
  {
    q: 'What if I cannot find my order?',
    a: 'Open the link from your receipt, or go to /orders to see recent orders on this device. If you paid by UPI, the UTR is on your UPI app\'s payment receipt.',
  },
  {
    q: 'What does "Urgent" mean?',
    a: 'Marking an order urgent puts it ahead of the queue. The shop may charge a small surcharge. Use it only when you genuinely need prints in the next few minutes.',
  },
];

export default function HelpPage() {
  return (
    <div className="customer-flow">
      <AppBar title="Help" subtitle="Frequently asked questions" />

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6 safe-bottom">
        {/* ── FAQ accordion ── */}
        <section aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-sm font-semibold text-[var(--color-ink)] mb-3">
            Frequently asked questions
          </h2>
          <ul className="space-y-2">
            {FAQ_ITEMS.map((item, idx) => (
              <li key={idx}>
                <FaqRow item={item} />
              </li>
            ))}
          </ul>
        </section>

        {/* ── Contact shop ── */}
        <section
          className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-3"
          aria-labelledby="contact-heading"
        >
          <h2 id="contact-heading" className="text-sm font-semibold text-[var(--color-ink)]">
            Contact the shop
          </h2>
          <p className="text-sm text-[var(--color-muted)]">
            For order-specific questions (status, payment verification, file changes), call the shop directly from your order tracking page.
          </p>
          <Link
            href="/orders"
            className="touch-target inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
          >
            <Phone className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
            Find my order
          </Link>
        </section>

        {/* ── Report a problem ──
            Contact controls render ONLY when the deployment has configured
            them (NEXT_PUBLIC_SUPPORT_EMAIL / NEXT_PUBLIC_SUPPORT_WHATSAPP).
            No broken links, no .local addresses (audit P2-3). */}
        <section
          className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-3"
          aria-labelledby="report-heading"
        >
          <h2 id="report-heading" className="text-sm font-semibold text-[var(--color-ink)]">
            Report a problem
          </h2>
          <p className="text-sm text-[var(--color-muted)]">
            Tell us what went wrong. If your report is about a specific order, include the order token from the tracking page URL so we can investigate faster.
          </p>
          {hasSupportEmail() && (
            <a
              href={supportMailto('Printelyx customer report', 'Describe what happened. If about an order, paste your order token here.')}
              className="touch-target inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] px-4 py-3 text-sm font-medium text-white min-h-[48px]"
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
              className="touch-target inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
            >
              <MessageSquare className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
              WhatsApp us
            </a>
          )}
          {!hasSupportEmail() && !hasSupportWhatsApp() && (
            <p className="text-sm text-[var(--color-muted)]">
              In-app support is being set up. For now, ask the shop directly — the tracking page has a Call shop button.
            </p>
          )}
        </section>

        {/* ── Footer links ── */}
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)] pt-2">
          <Link href="/" className="underline hover:text-[var(--color-ink)]">Home</Link>
          <Link href="/orders" className="underline hover:text-[var(--color-ink)]">My orders</Link>
          <Link href="/privacy" className="underline hover:text-[var(--color-ink)]">Privacy</Link>
        </nav>
      </main>
    </div>
  );
}

/** A single controlled accordion row. */
function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const buttonId = useId();

  return (
    <div className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] overflow-hidden">
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={regionId}
        className="touch-target w-full flex items-center justify-between gap-3 px-4 py-3 text-left min-h-[48px]"
      >
        <span className="text-sm font-medium text-[var(--color-ink)]">{item.q}</span>
        <ChevronDown
          className={[
            'size-4 shrink-0 text-[var(--color-muted)] transition-transform duration-200',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>
      <div
        id={regionId}
        role="region"
        aria-labelledby={buttonId}
        className={[
          'grid transition-all duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        ].join(' ')}
      >
        <div className="overflow-hidden">
          <p className="px-4 pb-4 pt-0 text-sm text-[var(--color-muted)] leading-relaxed">
            {item.a}
          </p>
        </div>
      </div>
    </div>
  );
}
