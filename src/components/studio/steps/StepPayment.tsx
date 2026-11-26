'use client';

import { useState } from 'react';
import { ArrowLeft, ShieldCheck, Loader2, Smartphone, Banknote, Copy, CheckCircle2 } from 'lucide-react';
import type { PlacedOrder, ShopCapabilities } from '../types';
import { formatRupees } from '../types';

/**
 * Step 4 — Payment.
 *
 * The order is already placed (the orchestrator called POST /orders before
 * arriving here). The server-generated total is authoritative — the
 * customer pays the exact `placed.totalPaise` the backend returned.
 *
 * Two payment paths, both using the EXISTING backend:
 *   1. UPI: a deep link to the shop's UPI ID + amount. After paying in any
 *      UPI app, the customer enters the 12-digit UTR (transaction reference)
 *      and submits it via POST /o/[token]/payment {method:'upi', utr}.
 *   2. Counter: the customer pays at the shop counter (cash or UPI) and the
 *      shopkeeper confirms. POST /o/[token]/payment {method:'counter_cash'
 *      |'counter_upi'}.
 *
 * The platform NEVER marks an order paid itself — the shopkeeper confirms
 * every payment. This screen submits the payment INTENT; the confirmation
 * step appears only after the backend accepts the submission.
 */
export function StepPayment({
  placed, shop, shopName, upiIntentUrl, onSubmitUtr, onChooseCounter, onBack,
}: {
  placed: PlacedOrder;
  shop: ShopCapabilities;
  shopName: string;
  upiIntentUrl: string | null;
  onSubmitUtr: (utr: string) => Promise<boolean>;
  onChooseCounter: (method: 'counter_cash' | 'counter_upi') => Promise<boolean>;
  onBack: () => void;
}) {
  const [utr, setUtr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [method, setMethod] = useState<'upi' | 'counter' | null>(null);

  const utrClean = utr.replace(/\D/g, '');
  const utrValid = utrClean.length === 12;

  const handlePayUpi = async () => {
    setSubmitting(true);
    if (upiIntentUrl) window.location.href = upiIntentUrl;
    setMethod('upi');
    setSubmitting(false);
  };

  const handleSubmitUtr = async () => {
    if (!utrValid) return;
    setSubmitting(true);
    await onSubmitUtr(utrClean);
    setSubmitting(false);
  };

  const copyOrderId = () => {
    navigator.clipboard?.writeText(placed.orderNumber).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--label)]">Payment</h1>
          <p className="mt-1 text-[14px] text-[var(--label-2)]">Order placed. Pay to confirm.</p>
        </div>
        <button onClick={onBack} className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]">
          <ArrowLeft className="size-4" /> Edit
        </button>
      </div>

      {/* Order confirmed card */}
      <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium text-[var(--label-2)]">Order number</p>
            <button onClick={copyOrderId} className="mt-0.5 flex items-center gap-1.5 text-[18px] font-bold text-[var(--label)]">
              {placed.orderNumber}
              {copied ? <CheckCircle2 className="size-4 text-[#16A34A]" /> : <Copy className="size-4 text-[var(--label-3)]" />}
            </button>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-medium text-[var(--label-2)]">Amount to pay</p>
            <p className="text-[24px] font-bold text-[var(--accent)]">{formatRupees(placed.totalPaise)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-[var(--accent-tint)] px-3 py-2">
          <ShieldCheck className="size-4 text-[var(--accent)]" />
          <p className="text-[12px] font-medium text-[var(--accent-tint-text)]">
            Pay {shopName} directly — 0% commission. The shopkeeper confirms your payment.
          </p>
        </div>
        {placed.pickupCode && (
          <p className="mt-2 text-[12px] text-[var(--label-2)]">Pickup code: <span className="font-mono font-bold text-[var(--label)]">{placed.pickupCode}</span></p>
        )}
      </div>

      {/* Payment method selection */}
      {!method && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handlePayUpi}
            disabled={submitting}
            className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--ground)]"
          >
            <div className="flex size-11 items-center justify-center rounded-[10px] bg-[var(--accent-tint)]">
              <Smartphone className="size-5 text-[var(--accent)]" />
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-[var(--label)]">Pay by UPI</p>
              <p className="text-[13px] text-[var(--label-2)]">Open your UPI app, pay {formatRupees(placed.totalPaise)} to {shop.upiId}, then enter the transaction ID.</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMethod('counter')}
            className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)]/40 hover:bg-[var(--ground)]"
          >
            <div className="flex size-11 items-center justify-center rounded-[10px] bg-[var(--ground)]">
              <Banknote className="size-5 text-[var(--label-2)]" />
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-[var(--label)]">Pay at the shop counter</p>
              <p className="text-[13px] text-[var(--label-2)]">Pay by cash or UPI when you collect your prints.</p>
            </div>
          </button>
        </div>
      )}

      {/* UPI flow: UTR entry */}
      {method === 'upi' && (
        <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
          <h2 className="text-[15px] font-semibold text-[var(--label)]">Enter your UPI transaction ID</h2>
          <p className="mt-1 text-[13px] text-[var(--label-2)]">
            After paying {formatRupees(placed.totalPaise)} to <span className="font-mono font-semibold text-[var(--label)]">{shop.upiId}</span>, find the 12-digit transaction reference (UTR) in your UPI app.
          </p>
          {upiIntentUrl && (
            <button onClick={handlePayUpi} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-white hover:bg-[var(--accent-press)]">
              <Smartphone className="size-4" /> Open UPI app again
            </button>
          )}
          <div className="mt-4">
            <label className="text-[13px] font-semibold text-[var(--label)]">Transaction ID (UTR)</label>
            <input
              type="text"
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="12-digit UTR number"
              inputMode="numeric"
              maxLength={12}
              className="mt-1 h-12 w-full rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-3 font-mono text-[16px] tracking-wider text-[var(--label)] placeholder:text-[var(--label-3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            <p className="mt-1 text-[11px] text-[var(--label-2)]">{utrClean.length}/12 digits</p>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setMethod(null)} className="inline-flex min-h-[44px] items-center rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]">Back</button>
            <button onClick={handleSubmitUtr} disabled={!utrValid || submitting} className="inline-flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-white hover:bg-[var(--accent-press)] disabled:opacity-50">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {submitting ? 'Submitting…' : 'I\'ve paid — submit UTR'}
            </button>
          </div>
        </div>
      )}

      {/* Counter flow */}
      {method === 'counter' && (
        <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
          <h2 className="text-[15px] font-semibold text-[var(--label)]">Pay at the counter</h2>
          <p className="mt-1 text-[13px] text-[var(--label-2)]">Tell the shopkeeper your order number and pay when you collect. They'll mark it paid.</p>
          <div className="mt-3 flex flex-col gap-2">
            <button onClick={() => void onChooseCounter('counter_cash')} disabled={submitting} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-white hover:bg-[var(--accent-press)]">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />} I'll pay by cash
            </button>
            <button onClick={() => void onChooseCounter('counter_upi')} disabled={submitting} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]">
              <Smartphone className="size-4" /> I'll pay by UPI at the counter
            </button>
            <button onClick={() => setMethod(null)} className="text-[13px] font-semibold text-[var(--label-2)] hover:text-[var(--label)]">Choose another method</button>
          </div>
        </div>
      )}
    </div>
  );
}
