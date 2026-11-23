'use client';

/**
 * /shop/orders/[id] — Screen 10: Shop Order Detail (mobile).
 *
 * Reference design HTML:
 *   <div class="ref-screen m">
 *     <div class="ref-top">Orders</div>
 *     <h1 class="ref-h">Order {orderNumber}</h1>
 *     <p class="ref-sub">{customerName}, {phone}</p>
 *     <div class="ref-g">  ← Payment + amount + screenshot
 *       <div class="ref-r"><span>Payment<small>UTR {utr}</small></span><span class="ref-chip a">To confirm</span></div>
 *       <div class="ref-r"><span>Amount</span><b>₹{amount}</b></div>
 *       <div class="ref-r"><span>Screenshot</span><span class="ref-v">View</span></div>
 *     </div>
 *     <div class="ref-g">  ← File + mini page indicators
 *       <div class="ref-r"><span>{fileName}<small>{pages} pages, double-sided</small></span></div>
 *       <div class="ref-mini" style="padding:0 0 14px"><i></i>…<i class="c"></i>…</div>
 *     </div>
 *     <div class="ref-g">  ← Print jobs (colour set / B&W set)
 *       <div class="ref-r"><span>Colour set, {n} pages<small>Colour printer</small></span><span class="ref-chip">Queued</span></div>
 *       <div class="ref-r"><span>B&amp;W set, {n} pages<small>B&amp;W printer</small></span><span class="ref-chip">Queued</span></div>
 *     </div>
 *     <div class="ref-bar"><button class="ref-btn k">Reject</button><button class="ref-btn">Confirm payment</button></div>
 *   </div>
 *
 * Data sources:
 *   - GET /api/v1/shops/me/orders/{id} → order detail with files.
 *   - POST /api/v1/shops/me/orders/{id}/confirm-payment with `{ action: 'confirm' }`
 *     or `{ action: 'reject', reason }` → marks the order paid or cancelled.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RefShopLayout, RefShopTabBar } from '@/components/ref-shop';
import { useApiClient } from '@/components/portal/use-api-client';

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

/** Render the mini-page-indicator strip: one <i> per page in the file.
 *  Colour pages get the `.c` modifier (gradient background). The reference
 *  design uses a fixed set of <i>s (12); we render one per actual page,
 *  capped at 24 to avoid overflow on very large files. */
function MiniPages({ file }: { file: PrintFile }) {
  const pages = Math.min(file.pageCount ?? 0, 24);
  if (pages === 0) return null;
  // Heuristic colour-page distribution: a colour-mode file is fully colour;
  // a B&W file is fully B&W. The real per-page colour breakdown lives in
  // `file.colorSuggestion` (server-side, not in the lightweight order row).
  const isColor = file.colorMode === 'color';
  const items = Array.from({ length: pages }, (_, i) => i);
  return (
    <div className="ref-mini" style={{ padding: '0 0 14px' }}>
      {items.map((i) => (
        <i key={i} className={isColor ? 'c' : ''} aria-hidden="true" />
      ))}
    </div>
  );
}

/** A single file's row + mini-page strip. Returns a fragment so the .ref-r
 *  and .ref-mini are siblings inside .ref-g (matches the reference HTML). */
function MiniFileBlock({ file }: { file: PrintFile }) {
  return (
    <>
      <div className="ref-r">
        <span>
          {file.originalFilename}
          <small>
            {file.pageCount ?? 0} pages, {file.duplex ? 'double-sided' : 'single-sided'}
          </small>
        </span>
      </div>
      <MiniPages file={file} />
    </>
  );
}

function OrderDetailInner() {
  const params = useParams();
  const router = useRouter();
  const api = useApiClient();
  const orderId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Keep the document title in sync with the order number for accessibility.
  useEffect(() => {
    document.title = `Order ${order?.tokenNumber ?? orderId ?? ''} · Printelyx`;
  }, [order, orderId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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

  const isAwaitingPayment = order?.status === 'awaiting_payment';

  const onConfirm = useCallback(async () => {
    if (!order) return;
    setBusy('confirm');
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${order.id}/confirm-payment`,
        { body: { action: 'confirm', method: 'upi' } },
      );
      if (r.status >= 400) {
        setActionError(r.data?.error?.message ?? `Could not confirm (HTTP ${r.status}).`);
        return;
      }
      // Success — go back to the orders list (the kanban). The order will
      // now appear in the "Queued" column.
      router.push('/shop/orders');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }, [api, order, router]);

  const onReject = useCallback(async () => {
    if (!order) return;
    const reason = window.prompt(
      'Give the customer a reason so they can fix the payment.',
      'Payment not received. Please re-check the UTR and try again.',
    );
    if (reason === null) return; // user cancelled
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setActionError('A reason is required so the customer can fix the payment.');
      return;
    }
    setBusy('reject');
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${order.id}/confirm-payment`,
        { body: { action: 'reject', reason: cleanReason } },
      );
      if (r.status >= 400) {
        setActionError(r.data?.error?.message ?? `Could not reject (HTTP ${r.status}).`);
        return;
      }
      router.push('/shop/orders');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  }, [api, order, router]);

  // ── Derived display values ──
  const orderNumber = order?.tokenNumber ?? order?.customerToken ?? orderId?.slice(-6);
  const customerName = order?.customerName ?? (order?.customerPhone ? 'Customer' : 'Walk-in customer');
  const customerPhone = order?.customerPhone ?? '—';
  const amountRupees = order ? Math.round(order.totalAmountPaise / 100) : 0;
  const utr = order?.paymentUtr ?? order?.paymentTxnId ?? '—';

  // File rows + per-file page counts.
  const files = order?.files ?? [];
  const totalPages = useMemo(
    () => files.reduce((acc, f) => acc + (f.pageCount ?? 0) * (f.copies ?? 1), 0),
    [files],
  );

  // Print-job summary: split files into colour-set vs B&W-set.
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

  // Payment chip text — matches the reference design's "To confirm" only when
  // the order is awaiting payment. Otherwise show the current status.
  const paymentChip: { label: string; cls: string } = useMemo(() => {
    if (!order) return { label: '—', cls: '' };
    switch (order.status) {
      case 'awaiting_payment':
        return { label: 'To confirm', cls: 'a' };
      case 'paid':
      case 'printing':
        return { label: 'Paid', cls: 'ok' };
      case 'ready':
      case 'collected':
        return { label: 'Paid', cls: 'ok' };
      case 'cancelled':
        return { label: 'Rejected', cls: 'rd' };
      case 'refunded':
        return { label: 'Refunded', cls: 'rd' };
      default:
        return { label: order.status, cls: '' };
    }
  }, [order]);

  // Print-job status chip — show "Queued" for paid/printing, "Ready" for
  // ready, "—" for awaiting-payment (no jobs dispatched yet).
  const printJobChip: { label: string; cls: string } = useMemo(() => {
    if (!order) return { label: '—', cls: '' };
    if (order.status === 'awaiting_payment') return { label: 'Queued', cls: '' };
    if (order.status === 'cancelled') return { label: 'Cancelled', cls: 'rd' };
    if (order.status === 'ready' || order.status === 'collected') return { label: 'Done', cls: 'ok' };
    return { label: 'Queued', cls: '' };
  }, [order]);

  if (loading) {
    return (
      <div className="ref-screen m">
        <div className="ref-top">Orders</div>
        <h1 className="ref-h">Loading…</h1>
        <p className="ref-sub">Fetching the order detail.</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="ref-screen m">
        <div className="ref-top">Orders</div>
        <h1 className="ref-h">Order not found</h1>
        <p className="ref-sub">This order may have been removed or doesn't belong to your shop.</p>
        <div className="ref-g">
          <button
            type="button"
            className="ref-btn"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => router.push('/shop/orders')}
          >
            Back to orders
          </button>
        </div>
        <RefShopTabBar />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="ref-screen m">
        <div className="ref-top">Orders</div>
        <h1 className="ref-h">Could not load</h1>
        <p className="ref-sub">{error ?? 'Unknown error'}</p>
        <div className="ref-g">
          <button
            type="button"
            className="ref-btn"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
        <RefShopTabBar />
      </div>
    );
  }

  return (
    <div className="ref-screen m">
      <div className="ref-top">Orders</div>
      <h1 className="ref-h">Order {orderNumber}</h1>
      <p className="ref-sub">{customerName}, {customerPhone}</p>

      {/* Payment section */}
      <div className="ref-g">
        <div className="ref-r">
          <span>
            Payment<small>UTR {utr}</small>
          </span>
          <span className={`ref-chip${paymentChip.cls ? ' ' + paymentChip.cls : ''}`}>
            {paymentChip.label}
          </span>
        </div>
        <div className="ref-r">
          <span>Amount</span>
          <b>₹{amountRupees.toLocaleString('en-IN')}</b>
        </div>
        <div className="ref-r">
          <span>Screenshot</span>
          <span className="ref-v">View</span>
        </div>
      </div>

      {/* File section — one row per file + the mini page strip below.
          The reference design puts the .ref-r and .ref-mini as siblings
          inside .ref-g (no wrapper div) so the .ref-r:last-child rule
          doesn't accidentally leave a border on the last file row. */}
      {files.length > 0 ? (
        <div className="ref-g">
          {files.map((f) => (
            <MiniFileBlock key={f.id} file={f} />
          ))}
        </div>
      ) : (
        <div className="ref-g">
          <div className="ref-r">
            <span>No files<small>The customer hasn't uploaded any files yet.</small></span>
          </div>
        </div>
      )}

      {/* Print-job section — colour set + B&W set */}
      <div className="ref-g">
        {colourPages > 0 ? (
          <div className="ref-r">
            <span>
              Colour set, {colourPages} pages<small>Colour printer</small>
            </span>
            <span className={`ref-chip${printJobChip.cls ? ' ' + printJobChip.cls : ''}`}>
              {printJobChip.label}
            </span>
          </div>
        ) : null}
        {bwPages > 0 ? (
          <div className="ref-r">
            <span>
              B&amp;W set, {bwPages} pages<small>B&amp;W printer</small>
            </span>
            <span className={`ref-chip${printJobChip.cls ? ' ' + printJobChip.cls : ''}`}>
              {printJobChip.label}
            </span>
          </div>
        ) : null}
        {colourPages === 0 && bwPages === 0 ? (
          <div className="ref-r">
            <span>
              {totalPages} pages<small>Queued for printing</small>
            </span>
            <span className={`ref-chip${printJobChip.cls ? ' ' + printJobChip.cls : ''}`}>
              {printJobChip.label}
            </span>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <p className="ref-cap" style={{ color: '#9C1F18' }}>
          {actionError}
        </p>
      ) : null}

      {/* Action bar — Reject + Confirm payment. Only show for awaiting-payment
          orders; once paid/cancelled, the bar disappears (no action to take). */}
      {isAwaitingPayment ? (
        <div className="ref-bar">
          <button
            type="button"
            className="ref-btn k"
            disabled={busy !== null}
            onClick={() => void onReject()}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            type="button"
            className="ref-btn"
            disabled={busy !== null}
            onClick={() => void onConfirm()}
          >
            {busy === 'confirm' ? 'Confirming…' : 'Confirm payment'}
          </button>
        </div>
      ) : (
        <RefShopTabBar />
      )}
    </div>
  );
}

export default function ShopOrderDetailPage() {
  return (
    <RefShopLayout>
      <OrderDetailInner />
    </RefShopLayout>
  );
}
