'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { useApiClient } from '@/components/phase2/use-api-client';

interface Analytics {
  revenue: { totalPaise: number; formatted: string };
  orderCount: { total: number; paid: number };
  byStatus: Record<string, number>;
  popular: { color: number; bw: number; duplex: number; simplex: number; a4: number; a3: number; other: number };
  hours: number[];
  peakHourUtc: number | null;
}

const PIE_COLOURS = ['#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#a3a3a3', '#ef4444', '#f97316'];

export function DashboardAnalytics({ api }: { api: ReturnType<typeof useApiClient> }) {
  const [a, setA] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const r = await api.request<{ data?: Analytics }>('GET', '/api/v1/shops/me/analytics');
      if (r.data?.data) setA(r.data.data);
      setLoading(false);
    })();
  }, [api]);

  if (loading || !a) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> loading analytics…</div>;

  const statusData = Object.entries(a.byStatus).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  const popularData = [
    { name: 'Colour', value: a.popular.color }, { name: 'B&W', value: a.popular.bw },
    { name: 'Duplex', value: a.popular.duplex }, { name: 'Simplex', value: a.popular.simplex },
  ].filter((d) => d.value > 0);
  const hourData = a.hours.map((count, h) => ({ hour: `${h}h`, count }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={a.revenue.formatted} />
        <Stat label="Orders" value={String(a.orderCount.total)} />
        <Stat label="Paid" value={String(a.orderCount.paid)} />
        <Stat label="Peak hr (UTC)" value={a.peakHourUtc !== null ? `${a.peakHourUtc}:00` : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Orders by status">
          {statusData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={70} label>
                  {statusData.map((_, i) => <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Popular settings">
          {popularData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={popularData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip />
                <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
      <ChartCard title="Orders by hour (UTC)">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={hourData}>
            <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={2} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip />
            <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border"><CardContent className="p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </CardContent></Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border"><CardHeader className="pb-1 pt-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="pb-3">{children}</CardContent></Card>
  );
}

function Empty() { return <p className="py-12 text-center text-xs text-muted-foreground">No data yet — complete an order to populate.</p>; }
