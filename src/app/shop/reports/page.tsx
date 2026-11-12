'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, Download, CheckCircle2, Clock, Receipt } from 'lucide-react';
import { formatINRFromPaise } from '@platform/utils';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { OrderStatusBadge } from '@/components/shared/status-indicator';
import { CardSkeleton } from '@/components/shared/loading-skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

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

/** Bucket the day's orders into hourly revenue buckets, in the shop's tz. */
function hourlyBuckets(
  orders: DailyReport['orders'],
  timezone: string,
): Array<{ label: string; revenue: number; orders: number }> {
  const map = new Map<number, { revenue: number; orders: number }>();
  for (const o of orders) {
    let hour: number;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(new Date(o.createdAt));
      hour = parseInt(parts, 10);
      if (hour === 24) hour = 0;
    } catch {
      hour = new Date(o.createdAt).getHours();
    }
    const slot = map.get(hour) ?? { revenue: 0, orders: 0 };
    slot.revenue += o.totalAmountPaise;
    slot.orders += 1;
    map.set(hour, slot);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([h, v]) => ({
      label: `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`,
      revenue: v.revenue,
      orders: v.orders,
    }));
}

function formatTime(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
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

  const avgOrderValuePaise = useMemo(() => {
    if (!report || report.summary.totalOrders === 0) return 0;
    return Math.round(report.totals.totalOrderValuePaise / report.summary.totalOrders);
  }, [report]);

  const chartData = useMemo(
    () => (report ? hourlyBuckets(report.orders, report.timezone) : []),
    [report],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Report"
        description="Reconciliation of orders, payments, and revenue for the selected day."
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-auto"
              aria-label="Report date"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5"
              aria-label="Refresh report"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {report && (
              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                className="gap-1.5"
              >
                <Download className="size-4" />
                <span>CSV</span>
              </Button>
            )}
          </div>
        }
      />

      {loading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {error && !loading && (
        <Card className="bg-danger-soft border-danger-border">
          <CardContent className="p-4 text-sm text-danger">{error}</CardContent>
        </Card>
      )}

      {report && !loading && (
        <>
          {/* Summary metric cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Revenue"
              value={formatINRFromPaise(report.totals.totalOrderValuePaise)}
              subtitle="Total order value"
            />
            <MetricCard
              label="Orders"
              value={String(report.summary.totalOrders)}
              subtitle={`${report.summary.verifiedPayments} verified`}
            />
            <MetricCard
              label="Avg order value"
              value={formatINRFromPaise(avgOrderValuePaise)}
              subtitle="Per order"
            />
            <MetricCard
              label="Verified collections"
              value={formatINRFromPaise(report.totals.verifiedCollectionsPaise)}
              subtitle={`${report.summary.pendingPayments} pending`}
            />
          </div>

          {/* Revenue chart */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Revenue by hour</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Hourly distribution of order value for {report.date} ({report.timezone})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <EmptyState
                  icon={<Receipt className="size-6" />}
                  title="No chart data"
                  description="No paid orders were placed on this date."
                />
              ) : (
                <ChartContainer
                  config={{ revenue: { label: 'Revenue', color: 'var(--brand)' } }}
                  className="h-[250px] sm:h-[300px] w-full"
                >
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      stroke="var(--border)"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      stroke="var(--border)"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `₹${Math.round(v / 100)}`}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatINRFromPaise(Number(value))}
                        />
                      }
                    />
                    <Bar
                      dataKey="revenue"
                      name="Revenue"
                      fill="var(--color-revenue)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Orders table */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Order details</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {report.orders.length} orders on {report.date} ({report.timezone})
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {report.orders.length === 0 ? (
                <EmptyState
                  icon={<Receipt className="size-6" />}
                  title="No orders today"
                  description={`No orders were placed on ${report.date}.`}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Token</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-center hidden sm:table-cell">Verified</TableHead>
                      <TableHead className="hidden md:table-cell text-right">Time</TableHead>
                      <TableHead className="hidden lg:table-cell">UTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-sm">{o.tokenNumber}</TableCell>
                        <TableCell>
                          <OrderStatusBadge status={o.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {o.totalAmount}
                        </TableCell>
                        <TableCell className="text-center hidden sm:table-cell">
                          {o.paymentVerified ? (
                            <CheckCircle2
                              className="mx-auto size-4 text-success"
                              aria-label="Payment verified"
                            />
                          ) : (
                            <Clock
                              className="mx-auto size-4 text-warning-foreground"
                              aria-label="Payment pending"
                            />
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right tabular-nums text-sm text-muted-foreground">
                          {formatTime(o.createdAt)}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                          {o.paymentUtr ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Payment reconciliation */}
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Payment reconciliation</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Status-based breakdown of order value for {report.date}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PaymentRow
                  label="Verified collections"
                  value={formatINRFromPaise(report.totals.verifiedCollectionsPaise)}
                  count={report.summary.verifiedPayments}
                  tone="text-success"
                />
                <PaymentRow
                  label="Outstanding"
                  value={formatINRFromPaise(report.totals.outstandingPaise)}
                  count={report.summary.pendingPayments}
                  tone="text-warning-foreground"
                />
                <PaymentRow
                  label="Cancelled value"
                  value={formatINRFromPaise(report.totals.cancelledValuePaise)}
                  count={report.summary.cancelledOrders}
                  tone="text-danger"
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card className="bg-surface">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function PaymentRow({
  label,
  value,
  count,
  tone,
}: {
  label: string;
  value: string;
  count: number;
  tone: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={`text-xs font-medium tabular-nums ${tone}`}>{count}</span>
      </div>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
