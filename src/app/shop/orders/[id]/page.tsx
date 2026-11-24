'use client';

/**
 * /shop/orders/[id] — spec screen 24: order detail.
 *
 * Clear ShopShell provides the chrome; this page renders only content.
 *
 * Data + actions (all real):
 *   - GET /api/v1/shops/me/orders/{id} → order + files.
 *   - Confirm / Reject payment → POST /api/v1/shops/me/orders/{id}/confirm-payment
 *     { action: 'confirm', method } / { action: 'reject', reason }.
 *   - After payment: Start printing → POST …/start; Mark ready → POST …/ready;
 *     Mark collected → POST …/complete. (All no-body POSTs.)
 *
 * Honest gaps:
 *   - Screenshot: the order record carries no payment screenshot (no
 *     field, no upload endpoint), so the card says "No screenshot was
 *     attached" instead of a dead "View" link.
 *   - Printer names in the print-split card: the order has no printer
 *     assignment, so sets are labelled "Colour printer" / "B&W printer"
 *     (the spec's own wording) rather than invented device names.
 *   - Gmail UTR verification: no gmail / check-utr code exists anywhere
 *     in this clone's shop pages (searched — zero hits), so there was
 *     nothing to preserve here. If the Gmail branch lands, its
 *     check-utr hook belongs on the payment card.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatINRFromPaise } from '@platform/utils';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Group,
  StatusPill,
  PrimaryButton,
  TintedButton,
  DestructiveButton,
  Input,
  EmptyState,
} from '@/components/clear';
import { FileText, ArrowLeft, Printer } from 'lucide-react';

interface PrintFile {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
  pageCount: number | null;
  copies: number;
  colorMode: 'bw' | 'color';
  pageRange: string | null;
  paperSize: string;
  duplex: boolean;
  pricePaise: number;
  status: string;
}

interface OrderDetail {
  id: string;
  customerToken: string;
  tokenNumber?: string | null;
  status:
    | 'awaiting_payment'
    | 'paid'
    | 'printing'
    | 'ready'
    | 'collected'
    | 'cancelled'
    | 'refunded';
  totalAmountPaise: number;
  paymentProvider?: string | null;
  paymentTxnId?: string | null;
  paymentUtr?: string | null;
  paidAt?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  files: PrintFile[];
}

type Busy = 'confirm' | 'reject' | 'start' | 'ready' | 'complete' | null;

function pillStatus(
  s: OrderDetail['status'],
): 'pending' | 'printing' | 'ready' | 'collected' | 'error' {
  switch (s) {
    case 'awaiting_payment':
      return 'pending';
    case 'printing':
      return 'printing';
    case 'ready':
      return 'ready';
    case 'collected':
      return 'collected';
    default:
      return 'error';
  }
}

function statusLabel(s: OrderDetail['status']): string {
  switch (s) {
    case 'awaiting_payment':
      return 'To confirm';
    case 'paid':
      return 'Paid — queued';
    case 'printing':
      return 'Printing';
    case 'ready':
      return 'Ready';
    case 'collected':
      return 'Collected';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
    default:
      return s;
  }
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mini page tiles: one per page, capped at 24. Colour files get the
 *  pastel tile, B&W files the grey tile (spec screen 24 strip). */
function PageTiles({ file }: { file: PrintFile }) {
  const pages = Math.min(file.pageCount ?? 0, 24);
  if (pages === 0) return null;
  const isColor = file.colorMode === 'color';
  return (
    <div className="flex flex-wrap gap-1.5 pt-2" aria-label={`${pages} page tiles`}>
      {Array.from({ length: pages }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={[
            'flex h-8 w-6 items-end justify-start rounded-[4px] p-0.5 text-[9px] font-semibold',
            isColor
              ? 'bg-gradient-to-br from-[#E6D9F3] via-[#DFDCF7] to-[#F7EFD2] text-[#5B4A8A]'
              : 'bg-[var(--fill)] text-[var(--label-3)]',
          ].join(' ')}
        >
          {i + 1}
        </span>
      ))}
      {(file.pageCount ?? 0) > 24 ? (
        <span className="self-center text-xs text-[var(--label-2)]">
          +{(file.pageCount ?? 0) - 24} more
        </span>
      ) : null}
    </div>
  );
}

export default function ShopOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const api = useApiClient();
  const orderId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState(
    'Payment not received. Please re-check the UTR and try again.',
  );
  const [method, setMethod] = useState<'upi' | 'counter_cash' | 'counter_upi'>('upi');

  useEffect(() => {
    document.title = `Order ${order?.tokenNumber ?? orderId ?? ''} · Printelyx`;
  }, [order, orderId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const r = await api.request<{ data?: OrderDetail; error?: { message?: string } }>(
        'GET',
        `/api/v1/shops/me/orders/${orderId}`,
      );
      if (r.status === 404 || r.status === 403) {
        setNotFound(true);
        setOrder(null);
        return;
      }
      if (r.status === 401) {
        router.replace('/shop/login');
        return;
      }
      if (r.status !== 200 || !r.data?.data) {
        setError(r.data?.error?.message ?? `Could not load order (HTTP ${r.status}).`);
        return;
      }
      setOrder(r.data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api, orderId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const postAction = useCallback(
    async (kind: Exclude<Busy, null>, path: string, body?: unknown) => {
      if (!order) return;
      setBusy(kind);
      setActionError(null);
      setActionOk(null);
      try {
        const r = await api.request<{ error?: { message?: string } }>(
          'POST',
          path,
          body !== undefined ? { body } : undefined,
        );
        if (r.status >= 400) {
          setActionError(r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`);
          return;
        }
        await load();
        setActionOk(
          kind === 'confirm'
            ? 'Payment confirmed — the order is queued for printing.'
            : kind === 'reject'
              ? 'Payment rejected — the customer has been notified with your reason.'
              : kind === 'start'
                ? 'Printing started.'
                : kind === 'ready'
                  ? 'Order marked ready for pickup.'
                  : 'Order marked collected.',
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setBusy(null);
      }
    },
    [api, order, load],
  );

  const onConfirm = useCallback(() => {
    if (!order) return;
    void postAction('confirm', `/api/v1/shops/me/orders/${order.id}/confirm-payment`, {
      action: 'confirm',
      method,
    });
  }, [order, postAction, method]);

  const onReject = useCallback(() => {
    if (!order) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setActionError('Give the customer a reason so they can fix the payment.');
      return;
    }
    void postAction('reject', `/api/v1/shops/me/orders/${order.id}/confirm-payment`, {
      action: 'reject',
      reason,
    });
  }, [order, postAction, rejectReason]);

  const files = order?.files ?? [];
  const totalPages = useMemo(
    () => files.reduce((acc, f) => acc + (f.pageCount ?? 0) * (f.copies ?? 1), 0),
    [files],
  );
  const colourPages = useMemo(
    () =>
      files
        .filter((f) => f.colorMode === 'color')
        .reduce((acc, f) => acc + (f.pageCount ?? 0) * (f.copies ?? 1), 0),
    [files],
  );
  const bwPages = useMemo(
    () =>
      files
        .filter((f) => f.colorMode === 'bw')
        .reduce((acc, f) => acc + (f.pageCount ?? 0) * (f.copies ?? 1), 0),
    [files],
  );

  const orderNumber = order?.tokenNumber ?? order?.customerToken ?? orderId?.slice(-6);
  const customerName =
    order?.customerName ?? (order?.customerPhone ? 'Customer' : 'Walk-in customer');
  const utr = order?.paymentUtr ?? order?.paymentTxnId ?? null;

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] font-bold text-[var(--label)]">Loading…</h1>
        <p className="text-sm text-[var(--label-2)]">Fetching the order detail.</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] font-bold text-[var(--label)]">Order not found</h1>
        <p className="text-sm text-[var(--label-2)]">
          This order may have been removed or doesn&apos;t belong to your shop.
        </p>
        <div>
          <TintedButton onClick={() => router.push('/shop/orders')}>Back to orders</TintedButton>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] font-bold text-[var(--label)]">Could not load</h1>
        <p className="text-sm text-[var(--label-2)]">{error ?? 'Unknown error'}</p>
        <div>
          <TintedButton onClick={() => void load()}>Try again</TintedButton>
        </div>
      </div>
    );
  }

  const isAwaitingPayment = order.status === 'awaiting_payment';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/shop/orders"
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Orders
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">
            Order {orderNumber}
          </h1>
          <StatusPill status={pillStatus(order.status)} label={statusLabel(order.status)} />
        </div>
        <p className="text-sm text-[var(--label-2)]">
          {customerName}, {order.customerPhone ?? 'no phone on file'}
        </p>
      </div>

      {actionError ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]" role="alert">
            {actionError}
          </p>
        </Group>
      ) : null}
      {actionOk ? (
        <Group>
          <p className="text-sm text-[var(--success-text)]" role="status">
            {actionOk}
          </p>
        </Group>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* Payment card */}
          <Group title="Payment">
            <dl className="flex flex-col gap-3 text-[15px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--label-2)]">UTR</dt>
                <dd className="font-mono text-[var(--label)]">{utr ?? 'Not provided yet'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
                <dt className="text-[var(--label-2)]">Amount</dt>
                <dd className="font-semibold tabular-nums text-[var(--label)]">
                  {formatINRFromPaise(order.totalAmountPaise)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
                <dt className="text-[var(--label-2)]">Screenshot</dt>
                <dd className="text-sm text-[var(--label-2)]">
                  No screenshot was attached to this order.
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
                <dt className="text-[var(--label-2)]">Paid at</dt>
                <dd className="text-sm text-[var(--label)]">
                  {order.paidAt ? new Date(order.paidAt).toLocaleString('en-IN') : '—'}
                </dd>
              </div>
            </dl>
          </Group>

          {/* Customer + note */}
          <Group title="Customer">
            <dl className="flex flex-col gap-3 text-[15px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--label-2)]">Name</dt>
                <dd className="text-[var(--label)]">{customerName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
                <dt className="text-[var(--label-2)]">Phone</dt>
                <dd className="font-mono text-[var(--label)]">{order.customerPhone ?? '—'}</dd>
              </div>
              {order.notes ? (
                <div className="border-t border-[var(--hairline)] pt-3">
                  <dt className="text-[var(--label-2)]">Note</dt>
                  <dd className="mt-1 text-[var(--label)]">{order.notes}</dd>
                </div>
              ) : null}
            </dl>
          </Group>
        </div>

        <div className="flex flex-col gap-4">
          {/* File card */}
          <Group title={`Files · ${totalPages} pages`}>
            {files.length === 0 ? (
              <EmptyState
                icon={<FileText className="size-7" />}
                title="No files yet"
                description="The customer hasn't uploaded any files for this order."
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {files.map((f) => (
                  <li key={f.id} className="border-b border-[var(--hairline)] pb-4 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium text-[var(--label)]">
                          {f.originalFilename}
                        </span>
                        <span className="block text-sm text-[var(--label-2)]">
                          {f.pageCount ?? 0} pages · {f.copies} {f.copies === 1 ? 'copy' : 'copies'} ·{' '}
                          {f.duplex ? 'double-sided' : 'single-sided'} · {f.paperSize.toUpperCase()} ·{' '}
                          {formatMB(f.sizeBytes)}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--accent-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-tint-text)]">
                        {f.colorMode === 'color' ? 'Colour' : 'B&W'}
                      </span>
                    </div>
                    <PageTiles file={f} />
                  </li>
                ))}
              </ul>
            )}
          </Group>

          {/* Print split */}
          <Group title="Print split">
            {colourPages === 0 && bwPages === 0 ? (
              <p className="text-sm text-[var(--label-2)]">
                {totalPages} pages queued for printing.
              </p>
            ) : (
              <ul className="flex flex-col gap-3 text-[15px]">
                {colourPages > 0 ? (
                  <li className="flex items-center justify-between gap-3">
                    <span>
                      Colour set, {colourPages} pages
                      <span className="block text-sm text-[var(--label-2)]">Colour printer</span>
                    </span>
                    <StatusPill
                      status={order.status === 'ready' || order.status === 'collected' ? 'ready' : 'printing'}
                      label={
                        order.status === 'awaiting_payment'
                          ? 'Queued'
                          : order.status === 'ready' || order.status === 'collected'
                            ? 'Done'
                            : 'Queued'
                      }
                    />
                  </li>
                ) : null}
                {bwPages > 0 ? (
                  <li
                    className={
                      colourPages > 0
                        ? 'flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3'
                        : 'flex items-center justify-between gap-3'
                    }
                  >
                    <span>
                      B&amp;W set, {bwPages} pages
                      <span className="block text-sm text-[var(--label-2)]">B&amp;W printer</span>
                    </span>
                    <StatusPill
                      status={order.status === 'ready' || order.status === 'collected' ? 'ready' : 'printing'}
                      label={
                        order.status === 'awaiting_payment'
                          ? 'Queued'
                          : order.status === 'ready' || order.status === 'collected'
                            ? 'Done'
                            : 'Queued'
                      }
                    />
                  </li>
                ) : null}
              </ul>
            )}
            <p className="pt-3 text-xs text-[var(--label-2)]">
              Printer names aren&apos;t assigned on the order record, so the
              sets are labelled by type. The dispatcher picks the device.
            </p>
          </Group>
        </div>
      </div>

      {/* Actions */}
      {isAwaitingPayment ? (
        <Group title="Confirm payment">
          <div className="flex flex-col gap-3">
            <label className="text-[13px] font-medium text-[var(--label-2)]" htmlFor="confirm-method">
              Payment method
            </label>
            <select
              id="confirm-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className="min-h-[48px] rounded-[var(--radius-input)] border border-transparent bg-[var(--fill)] px-3.5 text-base text-[var(--label)]"
            >
              <option value="upi">UPI (UTR shown above)</option>
              <option value="counter_upi">Counter UPI</option>
              <option value="counter_cash">Cash at counter</option>
            </select>
            <Input
              label="Reason (shown if you reject)"
              value={rejectReason}
              onChange={setRejectReason}
              hint="The customer sees this when a payment is rejected, so they can fix it."
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <DestructiveButton
                disabled={busy !== null}
                onClick={onReject}
                className="sm:flex-1"
              >
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </DestructiveButton>
              <PrimaryButton
                disabled={busy !== null}
                onClick={onConfirm}
                className="sm:flex-1"
              >
                {busy === 'confirm' ? 'Confirming…' : 'Confirm payment'}
              </PrimaryButton>
            </div>
          </div>
        </Group>
      ) : order.status === 'paid' ? (
        <Group title="Next step">
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton
              disabled={busy !== null}
              onClick={() => void postAction('start', `/api/v1/shops/me/orders/${order.id}/start`)}
              className="sm:flex-1"
            >
              <Printer className="size-4" aria-hidden="true" />
              {busy === 'start' ? 'Starting…' : 'Start printing'}
            </PrimaryButton>
          </div>
          <p className="pt-2 text-xs text-[var(--label-2)]">
            Payment is confirmed. Starting printing moves the order to the print queue.
          </p>
        </Group>
      ) : order.status === 'printing' ? (
        <Group title="Next step">
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton
              disabled={busy !== null}
              onClick={() => void postAction('ready', `/api/v1/shops/me/orders/${order.id}/ready`)}
              className="sm:flex-1"
            >
              {busy === 'ready' ? 'Marking…' : 'Mark ready for pickup'}
            </PrimaryButton>
          </div>
        </Group>
      ) : order.status === 'ready' ? (
        <Group title="Next step">
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton
              disabled={busy !== null}
              onClick={() => void postAction('complete', `/api/v1/shops/me/orders/${order.id}/complete`)}
              className="sm:flex-1"
            >
              {busy === 'complete' ? 'Marking…' : 'Mark collected'}
            </PrimaryButton>
          </div>
        </Group>
      ) : null}
    </div>
  );
}
