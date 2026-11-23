'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Smartphone, ArrowRight, Trash2, RefreshCw } from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';
import { StatusPill } from '@/components/clear/status-pill';
import { EmptyState } from '@/components/clear/empty-state';
import { SkeletonBox, SkeletonText } from '@/components/clear/compat';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/clear/compat';
import { TextField } from '@/components/clear/compat';
import { formatRupees } from '@/components/clear/price-breakdown';

import {
  readRecentOrders, forgetOrder, type RecentOrderSummary,
} from '@/lib/customer/recent-orders';
import { mapToPill, statusLabel } from '@/lib/customer/order-status-mapping';
import { track, ANALYTICS_EVENTS } from '@/lib/customer/analytics';

/**
 * /orders — "My orders": the customer's recent orders on THIS device.
 *
 * Each entry is a tiny summary saved to localStorage when an order is placed
 * (see CustomerOrderFlow's `place()`). The token IS the credential, so the
 * list is the device's view, not the customer's view across devices. A
 * "Look up by phone" panel teases the cross-device lookup — it's behind the
 * `OTP_ENABLED` feature flag (env: `NEXT_PUBLIC_OTP_ENABLED=true`). When the
 * flag is off (the default), the panel shows a "Coming soon" disabled button.
 *
 * OTP is OFF by default — the default order path stays on the 128-bit order
 * token + device-local recent-orders list. The OTP flow only protects the
 * cross-device lookup (which would otherwise leak which orders belong to a
 * given phone number to anyone who can type a number).
 */

// Read the feature flag at module load. NEXT_PUBLIC_* vars are inlined by
// Next.js at build time, so this is a build-time constant — flipping the
// env var requires a redeploy.
const OTP_ENABLED = process.env.NEXT_PUBLIC_OTP_ENABLED === 'true';

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<RecentOrderSummary[] | null>(null);

  // Read on the client only (localStorage isn't available on the server).
  useEffect(() => {
    setOrders(readRecentOrders());
  }, []);

  const onForget = (token: string) => {
    if (!window.confirm('Remove this order from your list? The order itself is not affected.')) return;
    forgetOrder(token);
    setOrders(readRecentOrders());
  };

  return (
    <div className="customer-flow">
      <AppBar title="My orders" subtitle="Orders placed on this device" />

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6 safe-bottom">
        {/* ── Recent orders on this device ── */}
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="text-sm font-semibold text-[var(--color-ink)] mb-3">
            Recent on this device
          </h2>

          {orders === null ? (
            // First-render skeleton — localStorage hasn't been read yet.
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4"
                  aria-hidden="true"
                >
                  <div className="flex items-center justify-between">
                    <SkeletonBox width="medium" height={20} />
                    <SkeletonBox width={84} height={22} radius="9999px" />
                  </div>
                  <div className="mt-2">
                    <SkeletonBox width="long" height={20} />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <SkeletonBox width="short" height={20} />
                    <SkeletonBox width={64} height={20} radius="var(--radius-tight)" />
                  </div>
                </div>
              ))}
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="size-7" />}
              title="No orders yet"
              description="Scan a shop's QR code to start your first print order."
              action={{ label: 'Find a shop', onClick: () => { window.location.href = '/'; } }}
            />
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.token}>
                  <OrderCard order={o} onForget={() => onForget(o.token)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Look up by phone ──
            When OTP_ENABLED is off (default), the panel shows a "Coming
            soon" disabled button. When on, it runs the OTP send → verify
            flow against /api/v1/auth/otp/{send,verify}. The full
            cross-device order list (after verify) is out of scope for P8.6
            — the OTP infrastructure is the deliverable. */}
        <PhoneLookupPanel otpEnabled={OTP_ENABLED} />

        {/* ── Footer links ── */}
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)] pt-2">
          <Link href="/" className="underline hover:text-[var(--color-ink)]">Home</Link>
          <span aria-hidden="true">·</span>
          <Link href="/help" className="underline hover:text-[var(--color-ink)]">Help</Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className="underline hover:text-[var(--color-ink)]">Privacy</Link>
        </nav>
      </main>
    </div>
  );
}

/**
 * Phone-lookup panel — gated by the OTP_ENABLED feature flag.
 *
 * Disabled (default): the section renders the phone input + a disabled
 * "Coming soon" button. The copy explains the cross-device lookup is on the
 * roadmap; the customer is told to open the receipt link for now.
 *
 * Enabled: the section runs a 2-step flow:
 *   1. Enter phone → POST /api/v1/auth/otp/send → "Code sent" state.
 *   2. Enter 6-digit code → POST /api/v1/auth/otp/verify → success path.
 * The actual cross-device order fetch after verify is a separate ticket —
 * this panel only proves the OTP infrastructure works end-to-end.
 */
function PhoneLookupPanel({ otpEnabled }: { otpEnabled: boolean }) {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [stage, setStage] = useState<'phone' | 'code' | 'verified'>('phone');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const onSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setPhoneError('Enter a 10-digit mobile number.');
      return;
    }
    setPhoneError(null);
    setSubmitting(true);
    try {
      // Anti-enumeration: the endpoint ALWAYS returns 200 `{ sent: true }`
      // — we proceed to the code stage regardless (the customer will retry
      // if no code arrives). The `sent: false, reason: 'disabled'` shape
      // only fires when the flag is off at the server, which shouldn't
      // happen here (the panel only renders this branch when otpEnabled).
      const res = await fetch('/api/v1/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      });
      const d = (await res.json()) as { data?: { sent?: boolean; reason?: string } };
      if (d?.data?.reason === 'disabled') {
        // Server flag is off but client flag was on at build time — treat
        // as "Coming soon" (the build will catch up on next deploy).
        setPhoneError('Phone lookup is coming soon. Open the tracking link from your receipt for now.');
        return;
      }
      setStage('code');
    } catch {
      setPhoneError('Could not send the code. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code from the SMS.');
      return;
    }
    setCodeError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), code }),
      });
      const d = (await res.json()) as {
        data?: { valid?: boolean; attemptsRemaining?: number };
        error?: { message?: string };
      };
      if (d?.data?.valid) {
        setStage('verified');
        setAttemptsRemaining(null);
        return;
      }
      const remaining = d?.data?.attemptsRemaining ?? null;
      setAttemptsRemaining(remaining);
      setCodeError(
        remaining === 0
          ? 'Too many wrong attempts. Request a new code and try again.'
          : `Wrong code. ${remaining ?? 0} attempt${remaining === 1 ? '' : 's'} left.`,
      );
    } catch {
      setCodeError('Could not verify the code. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4 space-y-3"
      aria-labelledby="phone-lookup-heading"
    >
      <div className="flex items-center gap-2">
        <Smartphone className="size-5 text-[var(--color-cyan-ink)]" aria-hidden="true" />
        <h2 id="phone-lookup-heading" className="text-sm font-semibold text-[var(--color-ink)]">
          Look up by phone
        </h2>
      </div>
      <p className="text-sm text-[var(--color-muted)]">
        {otpEnabled
          ? 'Enter your phone number to see all orders across devices. We\'ll send a one-time password to confirm it\'s you.'
          : 'Enter your phone number to see all orders across devices. (Coming soon — for now, open the link from your receipt.)'}
      </p>

      {!otpEnabled ? (
        // ── Disabled: "Coming soon" ──
        <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <TextField
            id="phone"
            label="Mobile number"
            placeholder="10-digit mobile"
            value={phone}
            onChange={setPhone}
            error={phoneError ?? undefined}
            inputMode="numeric"
            autoComplete="tel"
            disabled
          />
          <PrimaryButton type="submit" className="w-full" disabled>
            Coming soon
          </PrimaryButton>
        </form>
      ) : stage === 'phone' ? (
        // ── Stage 1: enter phone, send OTP ──
        <form onSubmit={onSendOtp} className="space-y-3">
          <TextField
            id="phone"
            label="Mobile number"
            placeholder="10-digit mobile"
            value={phone}
            onChange={setPhone}
            error={phoneError ?? undefined}
            inputMode="numeric"
            autoComplete="tel"
            hint="We'll send a one-time password to confirm it's you."
          />
          <PrimaryButton type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send code'}
          </PrimaryButton>
        </form>
      ) : stage === 'code' ? (
        // ── Stage 2: enter the 6-digit code ──
        <form onSubmit={onVerifyOtp} className="space-y-3">
          <TextField
            id="code"
            label="Verification code"
            placeholder="6-digit code"
            value={code}
            onChange={setCode}
            error={codeError ?? undefined}
            inputMode="numeric"
            autoComplete="one-time-code"
            hint={attemptsRemaining === null ? undefined : `${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} left`}
          />
          <PrimaryButton type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Verifying…' : 'Verify code'}
          </PrimaryButton>
          <TextButton
            type="button"
            onClick={() => { setStage('phone'); setCode(''); setCodeError(null); }}
            className="w-full"
          >
            Use a different number
          </TextButton>
        </form>
      ) : (
        // ── Stage 3: verified (placeholder — full cross-device list is a future ticket) ──
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-ink)]">
            Phone verified. Cross-device order history is being assembled — open the link from your receipt for now.
          </p>
          <TextButton type="button" onClick={() => { setStage('phone'); setPhone(''); setCode(''); }} className="w-full">
            Start over
          </TextButton>
        </div>
      )}
    </section>
  );
}

/** A single order row — shop name, date, status pill, total, track + reorder. */
function OrderCard({ order, onForget }: { order: RecentOrderSummary; onForget: () => void }) {
  const placedDate = new Date(order.placedAt);
  const dateLabel = Number.isNaN(placedDate.getTime())
    ? ''
    : placedDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <article className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-ink)] truncate">
            {order.shopName}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-muted)] tnum">
            {order.orderNumber ? `${order.orderNumber} · ` : ''}{dateLabel}
          </p>
        </div>
        <StatusPill
          status={mapToPill(order.status)}
          label={statusLabel(order.status)}
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-xs text-[var(--color-muted)]">Total</span>
        <span className="text-base font-semibold text-[var(--color-ink)] tnum tabular-nums">
          {formatRupees(order.totalPaise)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/o/${order.token}`}
          className="touch-target inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] px-4 text-sm font-medium text-white min-h-[48px]"
        >
          Track order
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {order.shopSlug ? (
          <Link
            href={`/s/${order.shopSlug}`}
            onClick={() => {
              track(ANALYTICS_EVENTS.reorderClicked, {
                shop_slug: order.shopSlug ?? '',
                source: 'orders_list',
              });
            }}
            className="touch-target inline-flex items-center justify-center gap-2 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
          >
            <RefreshCw className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
            Print again
          </Link>
        ) : (
          <TextButton
            onClick={() => {
              track(ANALYTICS_EVENTS.reorderClicked, {
                shop_slug: '',
                source: 'orders_list_no_slug',
              });
              window.location.href = '/';
            }}
            className="inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="size-4 text-[var(--color-cyan-ink)]" aria-hidden="true" />
            Print again
          </TextButton>
        )}
        <button
          type="button"
          onClick={onForget}
          aria-label={`Remove ${order.orderNumber ?? 'this order'} from the list`}
          className="touch-target inline-flex items-center justify-center rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-3 text-[var(--color-muted)] min-h-[48px] min-w-[48px]"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
