'use client';

/**
 * /shop/billing — spec screen 35.
 *
 * Data: GET /api/v1/shops/me → subscription { tier, state, isActive,
 * daysUntilExpiry } + subscriptionTier + subscriptionExpiresAt.
 *
 * Deliberately NOT invented:
 *   - The monthly fee amount. The PDF says "Standard — flat monthly fee,
 *     no commission" and never states a ₹ amount; no amount exists
 *     anywhere in the codebase either. The card therefore shows the plan
 *     and "Monthly fee — Not published" instead of a made-up number.
 *   - Invoices. There is no invoices API or invoice record in the
 *     codebase, so the invoice list is an honest empty state, not two
 *     fake "Invoice, Nov — Download" rows.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Group, TintedButton, EmptyState, StatusPill } from '@/components/clear';
import { Receipt, CreditCard } from 'lucide-react';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  subscriptionTier: string;
  subscriptionExpiresAt: string | null;
  subscription?: {
    tier?: string;
    state?: string;
    isActive?: boolean;
    daysUntilExpiry?: number | null;
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function ShopBillingPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Billing · Printelyx';
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me');
      if (r.status === 200 && r.data?.data) setShop(r.data.data);
      else if (r.status === 401) setError('Session expired. Please log in again.');
      else setError('Could not load billing.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.token) return;
    void load();
  }, [api.token, load]);

  const tier = shop?.subscription?.tier ?? shop?.subscriptionTier ?? '—';
  const active = shop?.subscription?.isActive ?? true;
  const state = shop?.subscription?.state ?? (active ? 'active' : 'inactive');
  const nextPayment = shop?.subscriptionExpiresAt ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Billing</h1>
        <p className="text-sm text-[var(--label-2)]">Your plan.</p>
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
          <div className="mt-3">
            <TintedButton onClick={() => void load()}>Try again</TintedButton>
          </div>
        </Group>
      ) : null}

      <Group title="Plan">
        {loading ? (
          <p className="text-sm text-[var(--label-2)]">Loading billing…</p>
        ) : (
          <dl className="flex flex-col gap-3 text-[15px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--label-2)]">Plan</dt>
              <dd className="font-semibold text-[var(--label)]">
                {tier === '—' ? 'Standard' : tier.charAt(0).toUpperCase() + tier.slice(1)}
                <span className="block text-right text-xs font-normal text-[var(--label-2)]">
                  Flat monthly fee, no commission
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
              <dt className="text-[var(--label-2)]">Monthly fee</dt>
              <dd className="text-[var(--label)]">Not published</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
              <dt className="text-[var(--label-2)]">Status</dt>
              <dd>
                <StatusPill
                  status={active ? 'ready' : 'error'}
                  label={active ? 'Active' : state}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
              <dt className="text-[var(--label-2)]">Next payment</dt>
              <dd className="tabular-nums text-[var(--label)]">{formatDate(nextPayment)}</dd>
            </div>
          </dl>
        )}
        <p className="pt-3 text-xs leading-relaxed text-[var(--label-2)]">
          No fee amount is shown because none is published: the plan is
          described as a flat monthly fee with no commission, but no ₹
          amount exists in the product. Ask the platform owner for the
          current fee before your next payment date.
        </p>
      </Group>

      <Group title="Invoices">
        <EmptyState
          icon={<Receipt className="size-7" />}
          title="No invoices yet"
          description="There is no invoice record for this shop. Invoices will appear here once billing starts."
        />
      </Group>

      <Group>
        <div className="flex items-center gap-3 text-sm text-[var(--label-2)]">
          <CreditCard className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Payments are collected by the platform, not by this portal. If a
            payment fails, your plan status above is what changes first.
          </span>
        </div>
      </Group>
    </div>
  );
}
