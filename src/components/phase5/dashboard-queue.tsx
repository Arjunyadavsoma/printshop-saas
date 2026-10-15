'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Printer, CheckCircle2, FileText } from 'lucide-react';
import type { useApiClient } from '@/components/phase2/use-api-client';
import { formatINRFromPaise } from '@platform/utils';

interface OrderRow {
  id: string;
  customerToken: string;
  status: string;
  totalAmountPaise: number;
  createdAt: string;
  files?: { id: string; originalFilename: string; status: string; copies: number; colorMode: string }[];
}

const STATUS_COLOUR: Record<string, string> = {
  awaiting_payment: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-700',
  printing: 'bg-sky-100 text-sky-700',
  ready: 'bg-violet-100 text-violet-700',
  collected: 'bg-zinc-200 text-zinc-600',
  cancelled: 'bg-rose-100 text-rose-700',
};

/**
 * The live order queue. Refreshes on realtime events (push — refreshKey bumps
 * when a socket.io event arrives) AND polls every 4s as a fallback for when
 * the realtime mini-service is unreachable.
 */
export function DashboardQueue({ api, refreshKey }: { api: ReturnType<typeof useApiClient>; refreshKey: number }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the queue now + poll every 4s. `refreshKey` bumps when a realtime
  // event arrives (push). The cancellation guard prevents setState after
  // unmount.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await api.request<{ data?: OrderRow[] }>('GET', '/api/v1/shops/me/orders?limit=50');
      if (!cancelled) {
        if (r.data?.data) setOrders(r.data.data);
        setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [api, refreshKey]);

  const reload = async () => {
    const r = await api.request<{ data?: OrderRow[] }>('GET', '/api/v1/shops/me/orders?limit=50');
    if (r.data?.data) setOrders(r.data.data);
  };
  const print = async (id: string) => { setBusy(id); await api.request('POST', `/api/v1/shops/me/orders/${id}/print`); await reload(); setBusy(null); };
  const complete = async (id: string) => { setBusy(id); await api.request('POST', `/api/v1/shops/me/orders/${id}/complete`); await reload(); setBusy(null); };

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> loading queue…</div>;
  if (orders.length === 0) return <div className="p-8 text-center text-sm text-muted-foreground">No orders yet. New orders appear here instantly via WebSocket.</div>;

  return (
    <div className="space-y-2.5">
      {orders.map((o) => (
        <Card key={o.id} className="border-border">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg font-bold text-amber-600">{o.customerToken}</span>
                <Badge className={STATUS_COLOUR[o.status] ?? 'bg-muted'} variant="secondary">{o.status}</Badge>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold text-foreground">{formatINRFromPaise(o.totalAmountPaise)}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(o.createdAt).toLocaleTimeString()}</p>
              </div>
            </div>
            {o.files && o.files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {o.files.map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                    <FileText className="h-2.5 w-2.5" /> {f.originalFilename} · {f.copies}× {f.colorMode} · <span className="text-muted-foreground">{f.status}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" disabled={o.status !== 'paid' || busy === o.id} onClick={() => print(o.id)} className="h-7 text-xs">
                {busy === o.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Printer className="mr-1 h-3 w-3" />} Print
              </Button>
              <Button size="sm" variant="outline" disabled={o.status !== 'ready' || busy === o.id} onClick={() => complete(o.id)} className="h-7 text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Mark collected
              </Button>
              {o.status === 'awaiting_payment' && <span className="self-center text-[10px] text-muted-foreground">awaiting payment…</span>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
