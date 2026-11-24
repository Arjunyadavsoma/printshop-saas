'use client';

import { useState } from 'react';
import Link from 'next/link';

import {
  hasSupportEmail,
  hasSupportWhatsApp,
  supportMailto,
  supportWhatsAppLink,
} from '@/lib/customer/support-config';

/**
 * /help — 1:1 replica of design board 15 (Site: help): FAQ rows in a card
 * (answer shown under the question when open), "Need a person?" card.
 * Real behavior: the full FAQ answers, support controls render only when
 * configured (NEXT_PUBLIC_SUPPORT_EMAIL / NEXT_PUBLIC_SUPPORT_WHATSAPP —
 * no broken links, no .local addresses, audit P2-3).
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
    <button
      type="button"
      className="r"
      style={{ cursor: 'pointer' }}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span>{item.q}{open && <small>{item.a}</small>}</span>
      <span className="v" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
  );
}

function FaqCard({ cls }: { cls: 'g' | 'gg' }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className={cls}>
      {FAQ_ITEMS.map((item, idx) => (
        <FaqRow
          key={idx}
          item={item}
          open={openIdx === idx}
          onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
        />
      ))}
    </div>
  );
}

function ContactCard({ cls }: { cls: 'g' | 'gg' }) {
  return (
    <div className={cls}>
      <div className="r">
        <span>Need a person?<small>For order questions, call the shop from your order page.</small></span>
        <span className="v" />
      </div>
      {hasSupportEmail() && (
        <a
          className="r"
          href={supportMailto('Printelyx customer report', 'Describe what happened. If about an order, paste your order token here.')}
        >
          <span>Email support</span>
          <span className="v">›</span>
        </a>
      )}
      {hasSupportWhatsApp() && (
        <a
          className="r"
          href={supportWhatsAppLink('Hello Printelyx support')}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>WhatsApp us</span>
          <span className="v">›</span>
        </a>
      )}
      <Link href="/orders" className="r">
        <span>Find my order</span>
        <span className="v">›</span>
      </Link>
    </div>
  );
}

export default function HelpPage() {
  return (
    <>
      <div className="x m">
        <div className="top"><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Help</h1>
        <p className="sub">Quick answers</p>
        <FaqCard cls="g" />
        <ContactCard cls="g" />
        <p className="cap" />
      </div>

      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <span className="v">Help</span>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Help</h1>
            <p className="s2">Quick answers</p>
            <FaqCard cls="gg" />
            <ContactCard cls="gg" />
          </div>
        </div>
      </div>
    </>
  );
}
