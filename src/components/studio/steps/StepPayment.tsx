'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  Banknote,
  Copy,
  CheckCircle2,
  Store,
  Receipt,
  AlertCircle,
  Lock,
} from 'lucide-react';
import type { PlacedOrder, ShopCapabilities, Quote } from '../types';
import { formatRupees } from '../types';
import { PrimaryButton } from '@/components/clear/button';
import { UTRInput } from '@/components/clear/utr-input';

/**
 * Step 4 — Payment (premium checkout).
 *
 * The order is already placed (POST /orders ran before this step). The
 * server-generated `placed.totalPaise` is the AUTHORITATIVE payable amount —
 * the customer pays exactly what the backend returned.
 *
 * Layout
 *   Desktop (lg+): two columns. Left = payment method selection + UTR entry.
 *   Right = sticky order summary (shop, order #, itemized quote, total,
 *   pickup code, Pay button). `lg:sticky lg:top-24` so it flows naturally.
 *   Mobile: single column. Payment cards above + a `fixed bottom-0` sticky
 *   bar with total + Pay button (`pb-[env(safe-area-inset-bottom)]`).
 *
 * Methods
 *   Reads `shop.paymentMethods` ('upi' | 'cash' | 'both' | 'split') and only
 *   shows methods the shop actually supports. Never fabricates a Razorpay /
 *   PhonePe option — only the genuinely configured direct-UPI + counter
 *   paths.
 *
 * State ownership
 *   The parent owns `submitting` (disables the Pay button + shows the
 *   spinner) and the transition to confirmation. This component just calls
 *   `onSubmitUtr(utr)` / `onChooseCounter(method)` and waits.
 */
export interface StepPaymentProps {
  shop: ShopCapabilities;
  placed: PlacedOrder;
  quote: Quote | null;
  upiIntentUrl: string | null;
  submitting: boolean;
  onSubmitUtr: (utr: string) => void;
  onChooseCounter: (method: 'counter_cash' | 'counter_upi') => void;
  onBack: () => void;
}

type MethodKey = 'upi' | 'counter_cash' | 'counter_upi';

/** A small toast for "copied to clipboard" feedback. */
function useCopiedFlag(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const trigger = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return [copied, trigger];
}

export function StepPayment({
  shop,
  placed,
  quote,
  upiIntentUrl,
  submitting,
  onSubmitUtr,
  onChooseCounter,
  onBack,
}: StepPaymentProps) {
  // ── Method gating ────────────────────────────────────────────────────────
  // Map shop.paymentMethods → which methods the customer is allowed to pick.
  const supportsUpi = useMemo(() => {
    return shop.paymentMethods === 'upi' || shop.paymentMethods === 'both' || shop.paymentMethods === 'split';
  }, [shop.paymentMethods]);
  const supportsCounterCash = useMemo(() => {
    return shop.paymentMethods === 'cash' || shop.paymentMethods === 'both' || shop.paymentMethods === 'split';
  }, [shop.paymentMethods]);
  // Counter UPI is offered alongside counter cash whenever counter payment is
  // available (the customer can always choose to pay by UPI at the counter).
  const supportsCounterUpi = supportsCounterCash;

  const availableMethods: MethodKey[] = useMemo(() => {
    const list: MethodKey[] = [];
    if (supportsUpi) list.push('upi');
    if (supportsCounterCash) list.push('counter_cash');
    if (supportsCounterUpi) list.push('counter_upi');
    return list;
  }, [supportsUpi, supportsCounterCash, supportsCounterUpi]);

  // Default selection: UPI first (the shop's preferred online method), else
  // counter_cash, else counter_upi.
  const [selected, setSelected] = useState<MethodKey | null>(() => availableMethods[0] ?? null);

  // UTR is stored formatted ("1234 5678 9012") — strip spaces before submit.
  const [utr, setUtr] = useState('');
  const utrDigits = utr.replace(/\D/g, '');
  const utrValid = utrDigits.length === 12;

  // "I've opened the UPI app" — once the customer has launched the UPI app,
  // the deep-link button morphs into a "Reopen UPI app" affordance so they
  // can come back if they switched away.
  const [upiLaunched, setUpiLaunched] = useState(false);

  const [copiedOrder, copyOrder] = useCopiedFlag();
  const [copiedUpi, copyUpi] = useCopiedFlag();

  const handleCopyOrder = () => {
    try {
      navigator.clipboard?.writeText(placed.orderNumber).then(copyOrder).catch(() => {});
    } catch { /* ignore */ }
  };
  const handleCopyUpi = () => {
    try {
      navigator.clipboard?.writeText(shop.upiId).then(copyUpi).catch(() => {});
    } catch { /* ignore */ }
  };

  const openUpiApp = () => {
    if (!upiIntentUrl) return;
    setUpiLaunched(true);
    // A full navigation triggers the OS UPI intent picker. The pending-order
    // restore logic in SmartPrintStudio handles the return trip.
    window.location.href = upiIntentUrl;
  };

  // ── Pay button state ────────────────────────────────────────────────────
  const payButton = useMemo(() => {
    if (!selected) {
      return { label: 'Select a payment method', disabled: true, action: null as null | (() => void) };
    }
    if (submitting) {
      return { label: 'Submitting…', disabled: true, action: null };
    }
    if (selected === 'upi') {
      if (!utrValid) return { label: 'Enter 12-digit UTR to pay', disabled: true, action: null };
      return {
        label: `Submit UTR · ${formatRupees(placed.totalPaise)}`,
        disabled: false,
        action: () => onSubmitUtr(utrDigits),
      };
    }
    if (selected === 'counter_cash') {
      return {
        label: `Confirm cash at counter · ${formatRupees(placed.totalPaise)}`,
        disabled: false,
        action: () => onChooseCounter('counter_cash'),
      };
    }
    // counter_upi
    return {
      label: `Confirm UPI at counter · ${formatRupees(placed.totalPaise)}`,
      disabled: false,
      action: () => onChooseCounter('counter_upi'),
    };
  }, [selected, submitting, utrValid, utrDigits, placed.totalPaise, onSubmitUtr, onChooseCounter]);

  // The itemized quote breakdown. The studio's quote is server-authoritative.
  const hasQuote = quote != null && quote.totalPaise != null && !quote.ruleMissing;
  const quoteLines = quote?.lines ?? [];
  const quoteAddons = quote?.addonsDetail ?? [];
  const quoteUrgent = quote?.urgentPaise ?? 0;

  // ── Reusable: order summary card (right rail desktop, hidden mobile) ────
  const summaryCard = (
    <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <div className="flex items-center gap-2 border-b border-[var(--hairline)] pb-4">
        <div className="flex size-9 items-center justify-center rounded-[10px] bg-[var(--accent-tint)]">
          <Store className="size-4 text-[var(--accent)]" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[var(--label)]">{shop.name}</p>
          <p className="text-[12px] text-[var(--label-2)]">Order {placed.orderNumber}</p>
        </div>
      </div>

      {/* Payable amount — front and centre. */}
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-[12px] font-medium text-[var(--label-2)]">Amount to pay</p>
          <p className="mt-0.5 text-[28px] font-bold leading-none text-[var(--accent)]">
            {formatRupees(placed.totalPaise)}
          </p>
        </div>
        {placed.pickupCode && (
          <div className="rounded-[8px] bg-[var(--accent-tint)] px-2.5 py-1.5 text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--accent-tint-text)]">Pickup</p>
            <p className="font-mono text-[14px] font-bold text-[var(--accent-tint-text)]">{placed.pickupCode}</p>
          </div>
        )}
      </div>

      {/* Itemized quote breakdown. */}
      {hasQuote && quoteLines.length > 0 && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-3)]">Printing charges</p>
          <ul className="mt-2 space-y-1.5">
            {quoteLines.map((line, i) => (
              <li key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--label-2)]">
                  {line.colorMode === 'COLOR' ? 'Colour' : 'B&W'} · {line.pages}p × {line.copies}
                </span>
                <span className="font-medium text-[var(--label)]">{formatRupees(line.linePaise)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasQuote && quoteAddons.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--label-3)]">Add-ons</p>
          <ul className="mt-1.5 space-y-1">
            {quoteAddons.map((a, i) => (
              <li key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--label-2)]">{a.label} × {a.quantity}</span>
                <span className="font-medium text-[var(--label)]">{formatRupees(a.linePaise)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasQuote && quoteUrgent > 0 && (
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <span className="text-[var(--label-2)]">Urgent surcharge</span>
          <span className="font-medium text-[var(--label)]">{formatRupees(quoteUrgent)}</span>
        </div>
      )}
      {hasQuote && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-[var(--label)]">Total</span>
            <span className="text-[18px] font-bold text-[var(--accent)]">{formatRupees(quote.totalPaise)}</span>
          </div>
        </div>
      )}
      {!hasQuote && (
        <p className="mt-4 rounded-[8px] bg-[var(--warning-bg)] px-3 py-2 text-[12px] font-medium text-[var(--warning)]">
          Final amount confirmed by the shop.
        </p>
      )}

      {/* Desktop Pay button lives inside the summary card. */}
      <div className="mt-5 hidden lg:block">
        <PrimaryButton
          type="button"
          className="w-full"
          loading={submitting}
          disabled={payButton.disabled}
          onClick={payButton.action ?? undefined}
          aria-busy={submitting || undefined}
        >
          {payButton.label}
        </PrimaryButton>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--label-3)]">
          <Lock className="size-3" aria-hidden="true" />
          Paid directly to {shop.name} · 0% commission
        </p>
      </div>
    </div>
  );

  // ── Reusable: a single payment-method card (radio-selectable) ──────────
  const renderMethodCard = (
    key: MethodKey,
    iconEl: React.ReactNode,
    title: string,
    subtitle: string,
  ) => {
    const isSelected = selected === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setSelected(key)}
        aria-pressed={isSelected}
        className={[
          'flex w-full items-start gap-3 rounded-[14px] border p-4 text-left transition-colors',
          isSelected
            ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
            : 'border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--accent)]/40 hover:bg-[var(--ground)]',
        ].join(' ')}
      >
        <div className={[
          'flex size-11 shrink-0 items-center justify-center rounded-[10px]',
          isSelected ? 'bg-[var(--accent)] text-white' : 'bg-[var(--accent-tint)] text-[var(--accent)]',
        ].join(' ')}>
          {iconEl}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[var(--label)]">{title}</p>
          <p className="mt-0.5 text-[13px] text-[var(--label-2)]">{subtitle}</p>
        </div>
        <span className={[
          'mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border',
          isSelected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--hairline)]',
        ].join(' ')} aria-hidden="true">
          {isSelected && <CheckCircle2 className="size-4 text-white" />}
        </span>
      </button>
    );
  };

  // ── UPI details panel (deep-link + UTR entry) ───────────────────────────
  const upiDetails = (
    <div className="mt-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-[var(--label)]">Pay by UPI</h3>
          <p className="mt-0.5 text-[13px] text-[var(--label-2)]">
            Pay {formatRupees(placed.totalPaise)} to <span className="font-mono font-semibold text-[var(--label)]">{shop.upiId}</span>, then enter the 12-digit transaction ID below.
          </p>
        </div>
      </div>

      {/* UPI ID + copy affordance. */}
      <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-[var(--hairline)] bg-[var(--ground)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Shop UPI ID</p>
          <p className="truncate font-mono text-[14px] font-semibold text-[var(--label)]">{shop.upiId}</p>
        </div>
        <button
          type="button"
          onClick={handleCopyUpi}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface)] px-2.5 text-[12px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
          aria-label="Copy UPI ID"
        >
          {copiedUpi ? (
            <>
              <CheckCircle2 className="size-3.5 text-[#16A34A]" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden="true" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* UPI deep-link button. */}
      {upiIntentUrl && (
        <button
          type="button"
          onClick={openUpiApp}
          disabled={submitting}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
          aria-busy={submitting || undefined}
        >
          <Smartphone className="size-4" aria-hidden="true" />
          {upiLaunched ? 'Reopen UPI app' : `Open UPI app · ${formatRupees(placed.totalPaise)}`}
        </button>
      )}

      {/* UTR entry — reuses the clear design UTRInput. */}
      <div className="mt-5">
        <UTRInput
          value={utr}
          onChange={setUtr}
          onSubmit={payButton.action ?? undefined}
        />
      </div>

      <p className="mt-3 rounded-[8px] bg-[var(--ground)] px-3 py-2 text-[12px] text-[var(--label-2)]">
        The shopkeeper verifies your UTR — Printelyx never holds your money. Submitting the reference starts confirmation; the shop typically confirms within a few minutes.
      </p>
    </div>
  );

  // ── Counter details panel ───────────────────────────────────────────────
  const counterDetails = (method: 'counter_cash' | 'counter_upi') => {
    if (selected !== method) return null;
    const isCash = method === 'counter_cash';
    return (
      <div className="mt-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
        <div className="flex items-start gap-3">
          {isCash ? (
            <Banknote className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          ) : (
            <Smartphone className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-[var(--label)]">
              {isCash ? 'Pay cash at the counter' : 'Pay by UPI at the counter'}
            </h3>
            <p className="mt-0.5 text-[13px] text-[var(--label-2)]">
              Tell the shopkeeper your order number — <span className="font-semibold text-[var(--label)]">{placed.orderNumber}</span> — and pay when you collect. They will mark the order paid.
            </p>
          </div>
        </div>
        {placed.pickupCode && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-[var(--accent-tint)] px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--accent-tint-text)]">Pickup code</span>
            <span className="font-mono text-[14px] font-bold text-[var(--accent-tint-text)]">{placed.pickupCode}</span>
          </div>
        )}
      </div>
    );
  };

  // ── Pay button content for mobile sticky bar (always visible on mobile) ─
  const mobilePayContent = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-[var(--label-2)]">
          {selected === 'upi' ? 'UPI · ' : selected === 'counter_cash' ? 'Cash at counter · ' : selected === 'counter_upi' ? 'UPI at counter · ' : ''}
          Order {placed.orderNumber}
        </p>
        <p className="text-[17px] font-bold leading-tight text-[var(--label)]">
          {formatRupees(placed.totalPaise)}
        </p>
      </div>
      <PrimaryButton
        type="button"
        loading={submitting}
        disabled={payButton.disabled}
        onClick={payButton.action ?? undefined}
        aria-busy={submitting || undefined}
        className="shrink-0"
      >
        {payButton.label}
      </PrimaryButton>
    </>
  );

  return (
    <div className="space-y-4 pb-28 lg:pb-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--label)]">Payment</h1>
          <p className="mt-1 text-[14px] text-[var(--label-2)]">Order placed. Pay to confirm.</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)] disabled:opacity-50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Edit
        </button>
      </div>

      {/* Trust banner */}
      <div className="flex items-center gap-2 rounded-[10px] bg-[var(--accent-tint)] px-3 py-2.5">
        <ShieldCheck className="size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <p className="text-[12px] font-medium text-[var(--accent-tint-text)]">
          You pay {shop.name} directly — 0% commission. The shopkeeper confirms every payment.
        </p>
      </div>

      {/* Mobile: compact order summary card (above the methods). */}
      <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4 lg:hidden">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Order number</p>
            <button
              type="button"
              onClick={handleCopyOrder}
              className="mt-0.5 flex items-center gap-1.5 text-[18px] font-bold text-[var(--label)]"
              aria-label="Copy order number"
            >
              {placed.orderNumber}
              {copiedOrder ? <CheckCircle2 className="size-4 text-[#16A34A]" aria-hidden="true" /> : <Copy className="size-4 text-[var(--label-3)]" aria-hidden="true" />}
            </button>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Amount to pay</p>
            <p className="text-[22px] font-bold text-[var(--accent)]">{formatRupees(placed.totalPaise)}</p>
          </div>
        </div>
        {placed.pickupCode && (
          <div className="mt-3 flex items-center justify-between border-t border-[var(--hairline)] pt-3">
            <span className="text-[13px] text-[var(--label-2)]">Pickup code</span>
            <span className="font-mono text-[15px] font-bold text-[var(--label)]">{placed.pickupCode}</span>
          </div>
        )}
      </div>

      {/* Two-column layout on desktop. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Left: payment method selection + UTR / counter details. */}
        <div className="min-w-0">
          <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[var(--label)]">
              <Receipt className="size-4 text-[var(--accent)]" aria-hidden="true" />
              Choose how to pay
            </h2>
            <p className="mt-1 text-[13px] text-[var(--label-2)]">
              Pick a method, then tap Pay at the bottom.
            </p>

            <div className="mt-4 space-y-3">
              {supportsUpi && renderMethodCard(
                'upi',
                <Smartphone className="size-5" aria-hidden="true" />,
                'UPI (online)',
                `Pay online to ${shop.upiId}, submit the transaction reference.`,
              )}
              {supportsCounterCash && renderMethodCard(
                'counter_cash',
                <Banknote className="size-5" aria-hidden="true" />,
                'Cash at counter',
                'Pay with cash when you collect your prints.',
              )}
              {supportsCounterUpi && renderMethodCard(
                'counter_upi',
                <Smartphone className="size-5" aria-hidden="true" />,
                'UPI at counter',
                'Pay by UPI in person at the shop counter.',
              )}
            </div>

            {/* Selected-method details. */}
            {selected === 'upi' && upiDetails}
            {selected === 'counter_cash' && counterDetails('counter_cash')}
            {selected === 'counter_upi' && counterDetails('counter_upi')}
          </div>

          {/* Helpful: what happens next. */}
          <div className="mt-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              <div>
                <p className="text-[13px] font-semibold text-[var(--label)]">How confirmation works</p>
                <p className="mt-1 text-[12px] text-[var(--label-2)]">
                  After you submit, the shop verifies the payment and starts printing. You will see the live status on the next screen.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: sticky order summary (desktop only). */}
        <aside className="hidden lg:block">
          <div className="lg:sticky lg:top-24">
            {summaryCard}
          </div>
        </aside>
      </div>

      {/* Mobile sticky bottom bar — fixed, safe-area-aware. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline)] bg-[var(--surface)]/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-[640px] items-center gap-3">
          {mobilePayContent}
        </div>
      </div>
    </div>
  );
}
