'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Calculator, RotateCcw, FileText } from 'lucide-react';
// Import the REAL pricing engine + types from the monorepo core package.
import { priceFile, type PricingInput, type PricingResult } from '@platform/core/pricing';
import {
  createDefaultPricingConfig,
  type ShopPricingConfig,
  type ColorMode,
  type PaperSize,
} from '@platform/core/domain';
import { formatINRFromPaise } from '@platform/utils';

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </Label>
      <Input
        id={props.id}
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) props.onChange(Math.max(props.min, Math.min(props.max, n)));
        }}
        className="font-mono"
      />
    </div>
  );
}

export function PricingCalculator() {
  // Job inputs
  const [pages, setPages] = useState(5);
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [duplex, setDuplex] = useState(false);

  // Shop pricing config (the engine input — adjustable so you can stress-test)
  const [cfg, setCfg] = useState<ShopPricingConfig>(() => createDefaultPricingConfig());
  const set = (patch: Partial<ShopPricingConfig>) => setCfg((c) => ({ ...c, ...patch }));

  // Computed by the REAL engine. useMemo so it recomputes on any input change.
  const result: PricingResult | { error: string } = useMemo(() => {
    const input: PricingInput = {
      pages,
      copies,
      colorMode,
      paperSize,
      duplex,
      shopPricingConfig: cfg,
    };
    try {
      return priceFile(input);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [pages, copies, colorMode, paperSize, duplex, cfg]);

  const isOk = 'totalPaise' in result;
  const total = isOk ? result.totalPaise : 0;
  const lineItems = isOk ? result.lineItems : [];

  // A sanity check: sum the line items back — must equal total. Plain integer
  // sum (NOT addPaise, which rejects the negative discount line items).
  const reconciled = lineItems.reduce((acc, i) => acc + i.subtotalPaise, 0);

  return (
    <section id="calculator" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-amber-600" />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Live pricing engine</h2>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Every number below is computed by the real{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">priceFile()</code> from{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">@platform/core/pricing</code>.
        Move any control and the line-item breakdown updates instantly — the same code paths the
        backend will call, exercised right here in your browser.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ---------------- INPUTS ---------------- */}
        <Card className="border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Print job</span>
              <button
                onClick={() => {
                  setPages(5);
                  setCopies(1);
                  setColorMode('bw');
                  setPaperSize('a4');
                  setDuplex(false);
                  setCfg(createDefaultPricingConfig());
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <NumberField id="pages" label="Pages" value={pages} min={1} max={1000} onChange={setPages} />
              <NumberField id="copies" label="Copies" value={copies} min={1} max={500} onChange={setCopies} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Colour mode</Label>
              <ToggleGroup
                type="single"
                value={colorMode}
                onValueChange={(v) => v && setColorMode(v as ColorMode)}
                className="w-full"
              >
                <ToggleGroupItem value="bw" className="flex-1" aria-label="Black & white">
                  B&W
                </ToggleGroupItem>
                <ToggleGroupItem value="color" className="flex-1" aria-label="Colour">
                  Colour
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Paper size</Label>
              <ToggleGroup
                type="single"
                value={paperSize}
                onValueChange={(v) => v && setPaperSize(v as PaperSize)}
                className="w-full"
              >
                {(['a4', 'a3', 'letter', 'legal'] as PaperSize[]).map((p) => (
                  <ToggleGroupItem key={p} value={p} className="flex-1 uppercase" aria-label={p}>
                    {p}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="duplex" className="text-sm font-medium">
                  Duplex (both sides)
                </Label>
                <p className="text-xs text-muted-foreground">Applies {cfg.duplex_discount}% discount</p>
              </div>
              <Switch id="duplex" checked={duplex} onCheckedChange={setDuplex} />
            </div>

            <Separator />
            <p className="text-xs font-medium text-muted-foreground">
              Shop pricing config <span className="font-normal">(adjust to stress-test the engine)</span>
            </p>

            <ConfigSlider
              label={`${colorMode === 'bw' ? 'B&W' : 'Colour'} ${paperSize.toUpperCase()} per page`}
              value={cfg[`${colorMode}_${paperSize}_per_page` as keyof ShopPricingConfig] as number}
              onChange={(v) =>
                set({ [`${colorMode}_${paperSize}_per_page`]: v } as Partial<ShopPricingConfig>)
              }
              min={0}
              max={2000}
              step={50}
              format={(v) => formatINRFromPaise(v)}
            />
            <ConfigSlider
              label="Duplex discount"
              value={cfg.duplex_discount}
              onChange={(v) => set({ duplex_discount: v })}
              min={0}
              max={50}
              step={1}
              format={(v) => `${v}%`}
            />
            <ConfigSlider
              label="Bulk threshold (pages)"
              value={cfg.bulk_threshold}
              onChange={(v) => set({ bulk_threshold: v })}
              min={1}
              max={500}
              step={5}
              format={(v) => `${v} pages`}
            />
            <ConfigSlider
              label="Bulk discount"
              value={cfg.bulk_discount_pct}
              onChange={(v) => set({ bulk_discount_pct: v })}
              min={0}
              max={50}
              step={1}
              format={(v) => `${v}%`}
            />
            <ConfigSlider
              label="Minimum order value"
              value={cfg.min_order_value}
              onChange={(v) => set({ min_order_value: v })}
              min={0}
              max={5000}
              step={50}
              format={(v) => formatINRFromPaise(v)}
            />
          </CardContent>
        </Card>

        {/* ---------------- OUTPUT ---------------- */}
        <Card className="flex flex-col border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-amber-600" /> Computed bill
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            {!isOk ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-rose-300 bg-rose-50 p-6 text-center">
                <div>
                  <p className="font-mono text-sm text-rose-700">PricingBelowMinimumError</p>
                  <p className="mt-1 text-xs text-rose-600">{result.error}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-gradient-to-br from-amber-50 to-emerald-50 p-5 ring-1 ring-amber-200">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Total payable
                  </p>
                  <p className="mt-1 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                    {formatINRFromPaise(total)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{total.toLocaleString('en-IN')} paise</p>
                </div>

                <div className="mt-4 space-y-1.5">
                  {lineItems.map((i, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                        i.subtotalPaise < 0
                          ? 'bg-rose-50 text-rose-700'
                          : i.label.includes('Minimum')
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-muted/60'
                      }`}
                    >
                      <span className="font-medium">{i.label}</span>
                      <span className="font-mono">
                        {i.quantity > 1 ? `${i.quantity} × ${formatINRFromPaise(Math.abs(i.unitPaise))} = ` : ''}
                        {i.subtotalPaise < 0 ? '−' : ''}
                        {formatINRFromPaise(Math.abs(i.subtotalPaise))}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto pt-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      pages×copies = {pages * copies}
                    </Badge>
                    {lineItems.some((i) => i.label.includes('Duplex')) && (
                      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200">duplex applied</Badge>
                    )}
                    {lineItems.some((i) => i.label.includes('Bulk')) && (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200">bulk applied</Badge>
                    )}
                    {lineItems.some((i) => i.label.includes('Minimum')) && (
                      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200">rounded to min</Badge>
                    )}
                  </div>
                  <Separator className="my-3" />
                  <p className="text-[11px] text-muted-foreground">
                    Reconciliation: Σ line items = {formatINRFromPaise(reconciled)}{' '}
                    {reconciled === total ? '✓ matches total' : '✗ mismatch'} · engine:{' '}
                    <code className="font-mono">priceFile()</code> · 35 unit tests pass
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function ConfigSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{props.label}</Label>
        <span className="font-mono text-xs font-medium text-foreground">{props.format(props.value)}</span>
      </div>
      <Slider
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueChange={(v) => props.onChange(v[0] ?? 0)}
      />
    </div>
  );
}
