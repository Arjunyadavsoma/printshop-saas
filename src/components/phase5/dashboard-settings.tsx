'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Save, Loader2, Cpu, CheckCircle2 } from 'lucide-react';
import type { useApiClient } from '@/components/phase2/use-api-client';
import { formatINRFromPaise } from '@platform/utils';
import type { ShopPricingConfig } from '@platform/core/domain';

interface ShopMe {
  id: string; name: string; upiId: string; paymentProvider: string;
  pricingConfig: ShopPricingConfig; phone: string; address: string;
}

export function DashboardSettings({ api }: { api: ReturnType<typeof useApiClient> }) {
  const [shop, setShop] = useState<ShopMe | null>(null);
  const [cfg, setCfg] = useState<ShopPricingConfig | null>(null);
  const [upi, setUpi] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [agents, setAgents] = useState<{ name: string; isOnline: boolean; os: string | null; version: string | null }[]>([]);

  useEffect(() => {
    void (async () => {
      const r = await api.request<{ data?: ShopMe }>('GET', '/api/v1/shops/me');
      if (r.data?.data) { setShop(r.data.data); setCfg(r.data.data.pricingConfig); setUpi(r.data.data.upiId); }
      const ag = await api.request<{ data?: typeof agents }>('GET', '/api/v1/shops/me/agents');
      if (ag.data?.data) setAgents(ag.data.data);
    })();
  }, [api]);

  const save = async () => {
    if (!cfg || !shop) return;
    setSaving(true); setSaved(false);
    await api.request('PATCH', '/api/v1/shops/me', { body: { pricingConfig: cfg, upiId: upi } });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!shop || !cfg) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> loading settings…</div>;

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Pricing configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <SliderRow label="B&W A4 / page" value={cfg.bw_a4_per_page} min={0} max={2000} step={50} format={formatINRFromPaise} onChange={(v) => setCfg({ ...cfg, bw_a4_per_page: v })} />
          <SliderRow label="Colour A4 / page" value={cfg.color_a4_per_page} min={0} max={2000} step={50} format={formatINRFromPaise} onChange={(v) => setCfg({ ...cfg, color_a4_per_page: v })} />
          <SliderRow label="Duplex discount %" value={cfg.duplex_discount} min={0} max={50} step={1} format={(v) => `${v}%`} onChange={(v) => setCfg({ ...cfg, duplex_discount: v })} />
          <SliderRow label="Bulk threshold (pages)" value={cfg.bulk_threshold} min={1} max={500} step={5} format={(v) => `${v} pg`} onChange={(v) => setCfg({ ...cfg, bulk_threshold: v })} />
          <SliderRow label="Bulk discount %" value={cfg.bulk_discount_pct} min={0} max={50} step={1} format={(v) => `${v}%`} onChange={(v) => setCfg({ ...cfg, bulk_discount_pct: v })} />
          <SliderRow label="Minimum order" value={cfg.min_order_value} min={0} max={5000} step={50} format={formatINRFromPaise} onChange={(v) => setCfg({ ...cfg, min_order_value: v })} />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Payment credentials</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div><Label className="text-xs text-muted-foreground">UPI VPA (money goes here, 0% commission)</Label><Input value={upi} onChange={(e) => setUpi(e.target.value)} className="mt-1 font-mono text-sm" /></div>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className="font-mono">{shop.paymentProvider}</Badge>
            <span className="text-[10px] text-muted-foreground">PhonePe salt + Paytm merchant key are stored encrypted (dev keys seeded for the demo).</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Cpu className="h-4 w-4 text-amber-600" /> Print agents</CardTitle></CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No agents registered yet. Phase 6's print-agent daemon registers here on first run.</p>
          ) : (
            <div className="space-y-1.5">
              {agents.map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-muted/50 px-2.5 py-1.5 text-xs">
                  <span className="font-medium">{a.name}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={a.isOnline ? 'default' : 'secondary'} className={a.isOnline ? 'bg-emerald-600 text-white' : ''}>{a.isOnline ? 'online' : 'offline'}</Badge>
                    <span className="text-muted-foreground">{a.os ?? '?'} · {a.version ?? '?'}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="w-full">
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-300" /> : <Save className="mr-2 h-4 w-4" />}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save settings'}
      </Button>
    </div>
  );
}

function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; format: (n: number) => string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground">{props.label}</Label><span className="font-mono text-xs font-medium text-foreground">{props.format(props.value)}</span></div>
      <Slider value={[props.value]} min={props.min} max={props.max} step={props.step} onValueChange={(v) => props.onChange(v[0] ?? 0)} />
    </div>
  );
}
