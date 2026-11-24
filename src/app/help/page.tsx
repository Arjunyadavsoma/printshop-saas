'use client';

import { useState } from 'react';
import Link from 'next/link';

import {
  hasSupportEmail,
  hasSupportWhatsApp,
  supportMailto,
  supportWhatsAppLink,
} from '@/lib/customer/support-config';
import { InfoShell } from '@/components/clear/info-shell';

/**
 * /help — spec screen 14: FAQ accordion ("+" at right, answer as sub-text
 * under the question when open) + "Need a person?" card. Answers are the
 * product's real behaviour; support controls render only when configured
 * (NEXT_PUBLIC_SUPPORT_EMAIL / NEXT_PUBLIC_SUPPORT_WHATSAPP).
 */

interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'How do I pay?',
    a: 'Tap your UPI app, then enter the 12-digit UTR. You pay the shop directly — Printelyx never touches your money.',
  },
  {
    q: 'How do I track my order?',
    a: 'Open the tracking link from your receipt, or use "Track an order" and paste your order link or token. The page shows the live step — Order placed, Payment confirmed, Printing, Ready for pickup — and your pickup code.',
  },
  {
    q: 'When will my prints be ready?',
    a: 'Most orders are ready in 10–20 minutes. The tracking page shows the live step — it changes from "Printing" to "Ready".',
  },
  {
    q: 'Is my payment safe?',
    a: 'You pay the shop directly by UPI. 0% commission, no middleman. We never see your card or UPI PIN.',
  },
  {
    q: 'Are my files private?',
    a: 'Files are deleted 24 hours after pickup, 7 days at most. See the Privacy page for the full policy.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes, before printing starts. Tap "Cancel order" on the tracking page. After that, paper and ink are used.',
  },
  {
    q: 'What if my prints are wrong?',
    a: 'If the shop printed the wrong pages, wrong colour, or missed pages, ask the shop to reprint them at no charge. If the shop will not fix it, contact Printelyx support from the Contact page with your order token and UTR.',
  },
  {
    q: 'I paid but it says pending',
    a: 'The shop verifies your UTR manually — usually within 1–2 minutes. You can call the shop from your order page or re-enter the UTR if it was rejected.',
  },
  {
    q: 'What if I cannot find my order?',
    a: 'Open the link from your receipt, or check My orders on this device. The UTR is on your UPI app\'s payment receipt.',
  },
  {
    q: 'What does "Urgent" mean?',
    a: 'Urgent orders go ahead of the queue; the shop may charge a small surcharge. Use it only when you truly need prints right now.',
  },
];

function FaqRow({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full min-h-[56px] cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="text-[16px] font-medium text-[var(--label)]">
          {item.q}
          {open && (
            <span className="mt-1 block text-[15px] font-normal leading-[1.5] text-[var(--label-2)]">
              {item.a}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[18px] text-[var(--label-2)]" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
    </div>
  );
}

export default function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <InfoShell>
      <p className="text-sm font-semibold text-[var(--label-2)]">Printelyx</p>
      <h1 className="mt-2 text-[28px] font-bold tracking-[-0.01em] text-[var(--label)]">Help</h1>
      <p className="mt-2 text-[16px] leading-[1.6] text-[var(--label-2)]">Quick answers</p>

      <div className="mt-6 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        {FAQ_ITEMS.map((item, idx) => (
          <FaqRow
            key={item.q}
            item={item}
            open={openIdx === idx}
            onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
          />
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        <div className="border-b border-border px-4 py-4">
          <p className="text-[16px] font-semibold text-[var(--label)]">Need a person?</p>
          <p className="mt-0.5 text-[15px] leading-[1.5] text-[var(--label-2)]">
            For order questions, call the shop from your order page.
          </p>
        </div>
        {hasSupportEmail() && (
          <a
            href={supportMailto('Printelyx customer report', 'Describe what happened. If about an order, paste your order token here.')}
            className="flex min-h-[48px] items-center justify-between gap-3 border-b border-border px-4 text-[15px] font-medium text-[var(--label)]"
          >
            Email support
            <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
          </a>
        )}
        {hasSupportWhatsApp() && (
          <a
            href={supportWhatsAppLink('Hello Printelyx support')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[48px] items-center justify-between gap-3 border-b border-border px-4 text-[15px] font-medium text-[var(--label)]"
          >
            WhatsApp us
            <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
          </a>
        )}
        <Link
          href="/track"
          className="flex min-h-[48px] items-center justify-between gap-3 px-4 text-[15px] font-medium text-[var(--label)]"
        >
          Find my order
          <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
        </Link>
      </div>
    </InfoShell>
  );
}
