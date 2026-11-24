'use client';

/**
 * /shop/setup — spec screen 20: onboarding checklist for a new shop.
 *
 * Steps are checked against REAL data, not a stored todo list:
 *   - Shop profile: name + phone present (GET /api/v1/shops/me).
 *   - UPI ID: upiId present.
 *   - Add a printer: at least one agent (GET /api/v1/shops/me/agents)
 *     or device (GET /api/v1/shops/me/devices).
 *   - Set prices: pricingConfig differs from the platform defaults
 *     (createDefaultPricingConfig). A shop still on defaults is "not done".
 *   - Print your QR poster: recorded on this device when the QR poster
 *     page is opened (localStorage — the server keeps no record of a
 *     poster being printed).
 *
 * Every step is skippable ("Skip setup" goes to the dashboard, and each
 * unfinished step links to the place that completes it).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createDefaultPricingConfig } from '@platform/core/domain';
import { useApiClient } from '@/components/portal/use-api-client';
import { Group, TintedButton, PrimaryButton } from '@/components/clear';
import { Check, ChevronRight } from 'lucide-react';

const QR_DONE_KEY = 'printshop:qr-poster-done';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string | null;
  phone: string | null;
  pricingConfig: Record<string, number>;
}

interface Step {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

export default function ShopSetupPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [hasPrinter, setHasPrinter] = useState(false);
  const [qrDone, setQrDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Set up your shop · Printelyx';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setQrDone(window.localStorage.getItem(QR_DONE_KEY) === '1');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shopR, agentsR, devicesR] = await Promise.all([
        api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        api.request<{ data?: unknown[] }>('GET', '/api/v1/shops/me/agents'),
        api.request<{ data?: unknown[] }>('GET', '/api/v1/shops/me/devices'),
      ]);
      if (shopR.status === 200 && shopR.data?.data) setShop(shopR.data.data);
      else if (shopR.status === 401) setError('Session expired. Please log in again.');
      const agents = agentsR.status === 200 && Array.isArray(agentsR.data?.data) ? agentsR.data.data : [];
      const devices = devicesR.status === 200 && Array.isArray(devicesR.data?.data) ? devicesR.data.data : [];
      setHasPrinter(agents.length > 0 || devices.length > 0);
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

  const steps: Step[] = useMemo(() => {
    const defaults = createDefaultPricingConfig() as unknown as Record<string, number>;
    const pricesChanged = shop
      ? (Object.keys(defaults) as string[]).some(
          (k) => shop.pricingConfig?.[k] !== undefined && shop.pricingConfig[k] !== defaults[k],
        )
      : false;
    return [
      {
        key: 'profile',
        label: 'Shop profile',
        href: '/shop/settings#profile',
        done: Boolean(shop?.name?.trim() && shop?.phone?.trim()),
      },
      {
        key: 'upi',
        label: 'UPI ID',
        href: '/shop/settings#payment',
        done: Boolean(shop?.upiId?.trim()),
      },
      {
        key: 'printer',
        label: 'Add a printer',
        href: '/shop/devices',
        done: hasPrinter,
      },
      {
        key: 'prices',
        label: 'Set prices',
        href: '/shop/services',
        done: pricesChanged,
      },
      {
        key: 'qr',
        label: 'Print your QR poster',
        href: '/shop/qr-poster',
        done: qrDone,
      },
    ];
  }, [shop, hasPrinter, qrDone]);

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">Set up your shop</h1>
        <p className="text-sm text-[var(--label-2)]">
          {loading ? 'Checking your shop…' : `${doneCount} of ${steps.length} done`}
        </p>
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
          <div className="mt-3">
            <TintedButton onClick={() => void load()}>Try again</TintedButton>
          </div>
        </Group>
      ) : null}

      <Group padding="rows">
        {steps.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className="flex min-h-[56px] items-center gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
          >
            <span
              className={[
                'flex size-6 shrink-0 items-center justify-center rounded-full',
                s.done
                  ? 'bg-[var(--success-tint)] text-[var(--success-text)]'
                  : 'border-2 border-[var(--hairline)] text-transparent',
              ].join(' ')}
              aria-hidden="true"
            >
              {s.done ? <Check className="size-4" /> : '·'}
            </span>
            <span className="flex-1 text-[15px] font-medium text-[var(--label)]">{s.label}</span>
            {s.done ? (
              <span className="text-sm text-[var(--label-2)]">Done</span>
            ) : (
              <span className="rounded-full bg-[var(--accent-tint)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-tint-text)]">
                Do this
              </span>
            )}
            <ChevronRight className="size-4 text-[var(--label-3)]" aria-hidden="true" />
          </Link>
        ))}
      </Group>

      <p className="text-sm text-[var(--label-2)]">
        You can skip any step and come back later.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/shop/dashboard" className="sm:flex-1">
          <PrimaryButton className="w-full">
            {doneCount === steps.length ? 'Go to dashboard' : 'Skip setup for now'}
          </PrimaryButton>
        </Link>
      </div>
    </div>
  );
}
