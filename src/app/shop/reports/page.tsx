'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Download, IndianRupee, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { formatINRFromPaise } from '@platform/utils';

interface DailyReport {
  date: string;
  timezone: string;
  summary: {
    totalOrders: number;
    verifiedPayments: number;
    pendingPayments: number;
    cancelledOrders: number;
    byStatus: Record<string, number>;
  };
  totals: {
    totalOrderValue: string;
    verifiedCollections: string;
    outstanding: string;
    cancelledValue: string;
    totalOrderValuePaise: number;
    verifiedCollectionsPaise: number;
    outstandingPaise: number;
    cancelledValuePaise: number;
  };
  orders: Array<{
    id: string; tokenNumber: string; status: string;
    totalAmount: string; totalAmountPaise: number;
    paymentVerified: boolean; paymentUtr: string | null;
    paidAt: string | null; createdAt: string;
  }>;
}

export default function ReportsPage() {
  const api = useApiClient();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await api.request<{ data?: DailyReport; error?: { message?: string } }>(
      'GET', `/api/v1/shops/me/reports/daily?date=${date}`,
    );
    setLoading(false);
    if (r.status !== 200 || !r.data?.data) {
      setError(r.data?.error?.message ?? 'Failed to load report');
      return;
    }
    setReport(r.data.data);
  }, [api, date]);

  useEffect(() => { void load(); }, [load]);

  const exportCSV = () => {
    if (!report) return;
    const rows = [
      ['Token', 'Status', 'Amount', 'Payment Verified', 'UTR', 'Paid At', 'Created At'],
      ...report.orders.map(o => [
        o.tokenNumber, o.status, o.totalAmount,
        o.paymentVerified ? 'Yes' : 'No',
        o.paymentUtr ?? '', o.paidAt ?? '', o.createdAt,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-report-${report.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Daily Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reconciliation of orders, payments, and revenue.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5 min-h-[44px]">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
          {report && (
            <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 min-h-[44px]">
              <Download className="size-4" /> CSV
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-amber-600" />
        </div>
      )}

      {error && (
        <Card className="border-destructive/30">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {report && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <MetricCard label="Total Orders" value={String(report.summary.totalOrders)} icon={IndianRupee} tone="text-foreground" />
            <MetricCard label="Verified" value={String(report.summary.verifiedPayments)} icon={CheckCircle2} tone="text-emerald-600" />
            <MetricCard label="Pending" value={String(report.summary.pendingPayments)} icon={Clock} tone="text-amber-600" />
            <MetricCard label="Cancelled" value={String(report.summary.cancelledOrders)} icon={XCircle} tone="text-rose-600" />
            <MetricCard label="By Status" value={Object.entries(report.summary.byStatus).map(([k,v]) => `${k}:${v}`).join(' ')} icon={IndianRupee} tone="text-muted-foreground" small />
          </div>

          {/* Financial totals */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyCard label="Total Order Value" value={report.totals.totalOrderValue} tone="text-foreground" />
            <MoneyCard label="Verified Collections" value={report.totals.verifiedCollections} tone="text-emerald-700" />
            <MoneyCard label="Outstanding" value={report.totals.outstanding} tone="text-amber-700" />
            <MoneyCard label="Cancelled Value" value={report.totals.cancelledValue} tone="text-rose-700" />
          </div>

          {/* Order list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order Details</CardTitle>
              <CardDescription className="text-xs">{report.orders.length} orders on {report.date} ({report.timezone})</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="bg-muted/60 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Token</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground">Verified</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">UTR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.orders.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No orders on this date.</td></tr>
                    ) : report.orders.map(o => (
                      <tr key={o.id}>
                        <td className="px-3 py-2 font-mono text-foreground">{o.tokenNumber}</td>
                        <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{o.status}</Badge></td>
                        <td className="px-3 py-2 text-right font-mono">{o.totalAmount}</td>
                        <td className="px-3 py-2 text-center">
                          {o.paymentVerified ? <CheckCircle2 className="mx-auto size-4 text-emerald-600" /> : <Clock className="mx-auto size-4 text-amber-600" />}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{o.paymentUtr ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, tone, small }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; tone: string; small?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${tone}`} />
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        </div>
        <p className={`mt-1 font-bold ${small ? 'text-xs' : 'text-xl'} ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function MoneyCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
