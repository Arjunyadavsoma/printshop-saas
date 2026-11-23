'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { PageHeader } from '@/components/shared/page-header';
import { CardSkeleton } from '@/components/shared/loading-skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { ShopPricingConfig } from '@platform/core/domain';
import { formatINRFromPaise } from '@platform/utils';
import { toast } from 'sonner';
import {
  Loader2,
  Save,
  RefreshCw,
  Wrench,
  Percent,
  Layers,
  IndianRupee,
  FileStack,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

/**
 * Pricing & services page.
 *
 * Surfaces the per-shop `pricingConfig` as an editable form. Rates are stored
 * as integer paise (1 INR = 100 paise) on the server; the form shows them in
 * rupees and converts to/from paise on edit and save.
 *
 * The PATCH endpoint validates via `ShopPricingConfigSchema` (Zod) — every
 * paise value must be a non-negative integer, percentages 0-100, threshold
 * non-negative integer. We clamp/round client-side so the request body is
 * always well-formed; the server remains the source of truth.
 */

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  pricingConfig: ShopPricingConfig;
}

type PriceKey =
  | 'bw_a4_per_page'
  | 'color_a4_per_page'
  | 'bw_a3_per_page'
  | 'color_a3_per_page'
  | 'bw_letter_per_page'
  | 'color_letter_per_page'
  | 'bw_legal_per_page'
  | 'color_legal_per_page';

interface PaperGroup {
  size: 'A4' | 'A3' | 'Letter' | 'Legal';
  bwKey: PriceKey;
  colorKey: PriceKey;
}

const PAPER_GROUPS: PaperGroup[] = [
  { size: 'A4', bwKey: 'bw_a4_per_page', colorKey: 'color_a4_per_page' },
  { size: 'A3', bwKey: 'bw_a3_per_page', colorKey: 'color_a3_per_page' },
  { size: 'Letter', bwKey: 'bw_letter_per_page', colorKey: 'color_letter_per_page' },
  { size: 'Legal', bwKey: 'bw_legal_per_page', colorKey: 'color_legal_per_page' },
];

/** Rupees (string) → integer paise, clamped to [0, ∞). */
function rupeesToPaise(input: string): number {
  const rupees = parseFloat(input);
  if (!Number.isFinite(rupees) || rupees < 0) return 0;
  return Math.round(rupees * 100);
}

/** Paise → rupees string with 2 decimal places (for the controlled input). */
function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Parse an integer from a string input, clamped to [min, max]. */
function parseIntClamped(input: string, min: number, max: number): number {
  const n = parseInt(input, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * A per-paper-size rate row. Stores the rupee string in local state for a
 * smooth editing experience (allows intermediate values like "1." or "0.5"
 * without fighting the parser); the parent form converts to paise on save.
 */
interface RateDraft {
  [key: string]: string;
}

export default function ShopServicesPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable drafts — kept as strings so the user can type "1." or "0.5"
  // without the input resetting on every keystroke. Conversion to paise /
  // ints happens on save.
  const [rateDraft, setRateDraft] = useState<RateDraft>({});
  const [duplexDiscount, setDuplexDiscount] = useState('0');
  const [bulkThreshold, setBulkThreshold] = useState('0');
  const [bulkDiscountPct, setBulkDiscountPct] = useState('0');
  const [minOrderRupees, setMinOrderRupees] = useState('0.00');

  useEffect(() => {
    document.title = 'Services & Pricing · Printelyx';
  }, []);

  // Hydrate the draft state from a freshly-loaded shop record.
  const hydrate = useCallback((s: ShopInfo) => {
    const p = s.pricingConfig;
    setRateDraft({
      bw_a4_per_page: paiseToRupees(p.bw_a4_per_page),
      color_a4_per_page: paiseToRupees(p.color_a4_per_page),
      bw_a3_per_page: paiseToRupees(p.bw_a3_per_page),
      color_a3_per_page: paiseToRupees(p.color_a3_per_page),
      bw_letter_per_page: paiseToRupees(p.bw_letter_per_page),
      color_letter_per_page: paiseToRupees(p.color_letter_per_page),
      bw_legal_per_page: paiseToRupees(p.bw_legal_per_page),
      color_legal_per_page: paiseToRupees(p.color_legal_per_page),
    });
    setDuplexDiscount(String(p.duplex_discount));
    setBulkThreshold(String(p.bulk_threshold));
    setBulkDiscountPct(String(p.bulk_discount_pct));
    setMinOrderRupees(paiseToRupees(p.min_order_value));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'GET',
        '/api/v1/shops/me',
      );
      if (r.status === 200 && r.data?.data) {
        setShop(r.data.data);
        hydrate(r.data.data);
      } else if (r.status === 401) {
        setError('Session expired. Please log in again.');
      } else {
        setError(r.data?.error?.message ?? 'Could not load pricing configuration.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const setRate = (key: PriceKey, value: string) => {
    setRateDraft((prev) => ({ ...prev, [key]: value }));
  };

  // Build the canonical ShopPricingConfig payload from the draft state.
  // Clamps + rounds to integers so the server-side Zod schema accepts it.
  const buildPricingConfig = useCallback((): ShopPricingConfig => {
    const r = (k: PriceKey) => rupeesToPaise(rateDraft[k] ?? '0');
    return {
      bw_a4_per_page: r('bw_a4_per_page'),
      color_a4_per_page: r('color_a4_per_page'),
      bw_a3_per_page: r('bw_a3_per_page'),
      color_a3_per_page: r('color_a3_per_page'),
      bw_letter_per_page: r('bw_letter_per_page'),
      color_letter_per_page: r('color_letter_per_page'),
      bw_legal_per_page: r('bw_legal_per_page'),
      color_legal_per_page: r('color_legal_per_page'),
      duplex_discount: parseIntClamped(duplexDiscount, 0, 100),
      bulk_threshold: parseIntClamped(bulkThreshold, 0, Number.MAX_SAFE_INTEGER),
      bulk_discount_pct: parseIntClamped(bulkDiscountPct, 0, 100),
      min_order_value: rupeesToPaise(minOrderRupees),
    };
  }, [rateDraft, duplexDiscount, bulkThreshold, bulkDiscountPct, minOrderRupees]);

  // Has the draft diverged from the persisted pricing? Used to enable the
  // Save button and to show an "unsaved changes" hint.
  const isDirty = useMemo(() => {
    if (!shop) return false;
    const next = buildPricingConfig();
    const prev = shop.pricingConfig;
    return (Object.keys(next) as (keyof ShopPricingConfig)[]).some(
      (k) => next[k] !== prev[k],
    );
  }, [shop, buildPricingConfig]);

  const save = async () => {
    if (!shop) return;
    const pricingConfig = buildPricingConfig();
    setSaving(true);
    try {
      const r = await api.request<{
        data?: ShopInfo;
        error?: { message?: string };
      }>('PATCH', '/api/v1/shops/me', { body: { pricingConfig } });
      if (r.status === 200 && r.data?.data) {
        setShop(r.data.data);
        hydrate(r.data.data);
        toast.success('Pricing updated', {
          description: 'Customers see the new prices immediately.',
        });
      } else {
        const msg =
          r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`;
        toast.error('Could not save pricing', { description: msg });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      toast.error('Could not save pricing', { description: msg });
    } finally {
      setSaving(false);
    }
  };

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Services & Pricing"
          description="Set the per-page rates and discount rules customers see when ordering."
        />
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  // ── Render: hard error ──
  if (error && !shop) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Services & Pricing"
          description="Set the per-page rates and discount rules customers see when ordering."
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="text-base text-danger">
              Couldn&apos;t load pricing configuration
            </CardTitle>
            <CardDescription className="text-danger">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => void load()}
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5"
            >
              <RefreshCw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!shop) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services & Pricing"
        description="Set the per-page rates and discount rules customers see when ordering."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={saving}
            className="min-h-[44px] gap-1.5"
            aria-label="Reload pricing"
          >
            <RefreshCw className="size-4" /> Reload
          </Button>
        }
      />

      {/* Per-page rates — paper sizes × color modes */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Wrench className="size-4 text-brand" aria-hidden="true" />
            Per-page rates
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Prices are in rupees. Internally stored as integer paise (1 INR = 100 paise).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate border-spacing-y-2">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 font-medium">Paper size</th>
                  <th className="px-2 font-medium">B&amp;W (per page)</th>
                  <th className="px-2 font-medium">Colour (per page)</th>
                </tr>
              </thead>
              <tbody>
                {PAPER_GROUPS.map(({ size, bwKey, colorKey }) => (
                  <tr key={size}>
                    <td className="px-2">
                      <div className="flex items-center gap-2">
                        <FileStack
                          className="size-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="font-medium">{size}</span>
                      </div>
                    </td>
                    <td className="px-2">
                      <PriceInput
                        value={rateDraft[bwKey] ?? '0.00'}
                        onChange={(v) => setRate(bwKey, v)}
                        disabled={saving}
                        label={`Black and white rate for ${size}`}
                      />
                    </td>
                    <td className="px-2">
                      <PriceInput
                        value={rateDraft[colorKey] ?? '0.00'}
                        onChange={(v) => setRate(colorKey, v)}
                        disabled={saving}
                        label={`Colour rate for ${size}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Discounts & bulk rules */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Percent className="size-4 text-brand" aria-hidden="true" />
            Discounts &amp; bulk rules
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Duplex (double-sided) and bulk discounts are applied automatically at checkout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FieldLabel
              label="Duplex discount"
              hint="Percent saved when both sides are printed"
              icon={<Percent className="size-3.5" aria-hidden="true" />}
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={duplexDiscount}
                  onChange={(e) => setDuplexDiscount(e.target.value)}
                  disabled={saving}
                  className="h-11 text-base tabular-nums sm:h-9 sm:text-sm"
                  aria-label="Duplex discount percentage"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </FieldLabel>

            <FieldLabel
              label="Bulk threshold"
              hint="Total pages above which the bulk discount applies"
              icon={<Layers className="size-3.5" aria-hidden="true" />}
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={bulkThreshold}
                  onChange={(e) => setBulkThreshold(e.target.value)}
                  disabled={saving}
                  className="h-11 text-base tabular-nums sm:h-9 sm:text-sm"
                  aria-label="Bulk threshold in pages"
                />
                <span className="text-sm text-muted-foreground">pages</span>
              </div>
            </FieldLabel>

            <FieldLabel
              label="Bulk discount"
              hint="Percent saved once the bulk threshold is met"
              icon={<Percent className="size-3.5" aria-hidden="true" />}
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={bulkDiscountPct}
                  onChange={(e) => setBulkDiscountPct(e.target.value)}
                  disabled={saving}
                  className="h-11 text-base tabular-nums sm:h-9 sm:text-sm"
                  aria-label="Bulk discount percentage"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </FieldLabel>
          </div>

          <Separator />

          <FieldLabel
            label="Minimum order value"
            hint="Orders below this amount are not accepted"
            icon={<IndianRupee className="size-3.5" aria-hidden="true" />}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground tabular-nums">
                ₹
              </span>
              <Input
                type="number"
                step="0.50"
                min="0"
                value={minOrderRupees}
                onChange={(e) => setMinOrderRupees(e.target.value)}
                disabled={saving}
                className="h-11 w-32 text-base tabular-nums sm:h-9 sm:text-sm"
                aria-label="Minimum order value in rupees"
              />
              <span className="text-sm text-muted-foreground">
                = {formatINRFromPaise(rupeesToPaise(minOrderRupees))}
              </span>
            </div>
          </FieldLabel>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-medium">
              Shop: {shop.name}
            </Badge>
            {isDirty ? (
              <span className="flex items-center gap-1 text-warning-foreground">
                <AlertCircle className="size-3.5" aria-hidden="true" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                All rates saved
              </span>
            )}
          </div>
          <Button
            onClick={() => void save()}
            disabled={saving || !isDirty}
            className="min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? 'Saving…' : 'Save pricing'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/* ── Local UI helpers ────────────────────────────────────────────────── */

function PriceInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground tabular-nums">₹</span>
      <Input
        type="number"
        step="0.50"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-11 w-24 text-base tabular-nums sm:h-9 sm:text-sm"
        aria-label={label}
      />
      <span className="text-xs text-muted-foreground">/ page</span>
    </div>
  );
}

function FieldLabel({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
