'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { StatusBadge } from '@/components/portal/status-badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINRFromPaise } from '@platform/utils';
import {
  Loader2,
  Printer as PrinterIcon,
  CheckCircle2,
  Clock,
  IndianRupee,
  RefreshCw,
  FileText,
  Inbox,
  Wifi,
  WifiOff,
  LayoutDashboard,
} from 'lucide-react';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  address: string;
  phone: string;
  isActive: boolean;
}

interface OrderRow {
  id: string;
  customerToken: string;
  status:
    | 'awaiting_payment'
    | 'paid'
    | 'printing'
    | 'ready'
    | 'collected'
    | 'cancelled'
    | 'refunded';
  totalAmountPaise: number;
  createdAt: string;
  paidAt: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
}

interface Analytics {
  revenue: { totalPaise: number; formatted: string };
  orderCount: { total: number; paid: number };
  byStatus: Record<string, number>;
}

function isToday(iso: string): boolean {
  try {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch {
    return false;
  }
}

export default function ShopDashboardPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [shopR, ordersR, analyticsR, agentsR] = await Promise.all([
        api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        api.request<{ data?: OrderRow[] }>('GET', '/api/v1/shops/me/orders?limit=50'),
        api.request<{ data?: Analytics }>('GET', '/api/v1/shops/me/analytics'),
        api.request<{ data?: AgentRow[] }>('GET', '/api/v1/shops/me/agents'),
      ]);
      if (shopR.status === 200 && shopR.data?.data) setShop(shopR.data.data);
      if (ordersR.status === 200 && ordersR.data?.data) setOrders(ordersR.data.data);
      if (analyticsR.status === 200 && analyticsR.data?.data) setAnalytics(analyticsR.data.data);
      if (agentsR.status === 200 && agentsR.data?.data) setAgents(agentsR.data.data);
      if (shopR.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (shopR.status >= 500) {
        setError('The server had a problem loading the dashboard. Try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Auto-refresh every 15s so the queue + agent status stay live without
    // spinning the whole screen.
    const id = setInterval(() => void load(true), 15_000);
    return () => clearInterval(id);
  }, []);

  // Aggregate today's quick stats from the orders list — analytics carries the
  // totals, but the per-day split is derived here (the analytics endpoint
  // returns all-time + by-status counts only).
  const todays = useMemo(() => {
    const todaysOrders = orders.filter((o) => isToday(o.createdAt));
    const todaysPaid = todaysOrders.filter(
      (o) => o.status !== 'awaiting_payment' && o.status !== 'cancelled',
    );
    const revenuePaise = todaysPaid.reduce((acc, o) => acc + o.totalAmountPaise, 0);
    const counts = {
      total: todaysOrders.length,
      awaitingPrinting: todaysOrders.filter((o) => o.status === 'paid').length,
      printing: todaysOrders.filter((o) => o.status === 'printing').length,
      completed: todaysOrders.filter(
        (o) => o.status === 'collected' || o.status === 'ready',
      ).length,
      revenue: revenuePaise,
    };
    return counts;
  }, [orders]);

  const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);

  const anyAgentOnline = agents.some((a) => a.isOnline);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-base text-rose-800">Couldn’t load the dashboard</CardTitle>
          <CardDescription className="text-rose-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void load()} variant="outline" size="sm">
            <RefreshCw className="size-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      label: "Today's orders",
      value: String(todays.total),
      icon: Inbox,
      tone: 'text-amber-700',
      bg: 'bg-amber-50',
    },
    {
      label: 'Awaiting print',
      value: String(todays.awaitingPrinting),
      icon: Clock,
      tone: 'text-sky-700',
      bg: 'bg-sky-50',
    },
    {
      label: 'Printing now',
      value: String(todays.printing),
      icon: PrinterIcon,
      tone: 'text-amber-700',
      bg: 'bg-amber-50',
    },
    {
      label: 'Completed today',
      value: String(todays.completed),
      icon: CheckCircle2,
      tone: 'text-emerald-700',
      bg: 'bg-emerald-50',
    },
    {
      label: "Today's sales",
      value: formatINRFromPaise(todays.revenue),
      icon: IndianRupee,
      tone: 'text-emerald-700',
      bg: 'bg-emerald-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-amber-600" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              {shop?.name ?? 'Dashboard'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {shop ? `slug: ${shop.slug}` : 'Overview of today’s activity'}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="gap-1.5"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="border-border">
              <CardContent className="flex flex-col gap-2 p-4">
                <div className={`flex size-8 items-center justify-center rounded-md ${s.bg}`}>
                  <Icon className={`size-4 ${s.tone}`} />
                </div>
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className="text-lg font-semibold tracking-tight sm:text-xl">{s.value}</span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Agent banner */}
      <Card
        className={`border-l-4 ${
          anyAgentOnline
            ? 'border-l-emerald-400 bg-emerald-50/50'
            : 'border-l-amber-400 bg-amber-50/50'
        }`}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            {anyAgentOnline ? (
              <Wifi className="size-5 text-emerald-600" />
            ) : (
              <WifiOff className="size-5 text-amber-600" />
            )}
            <div>
              <p className="text-sm font-medium">
                {anyAgentOnline
                  ? 'Print agent online'
                  : 'No print agent connected — manual downloads still work'}
              </p>
              <p className="text-xs text-muted-foreground">
                {agents.length === 0
                  ? 'No agents registered yet.'
                  : `${agents.length} agent(s) registered · ${agents.filter((a) => a.isOnline).length} online`}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/shop/printer">
              <PrinterIcon className="size-4" />
              {anyAgentOnline ? 'Manage' : 'Set up'}
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Recent orders */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Recent orders</CardTitle>
          <CardDescription className="text-xs">
            The last 10 orders placed at your shop. Click a row to manage prints and downloads.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Inbox className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No orders yet</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Your shop has no orders. Share your QR code with customers so they can scan, upload,
                and pay directly to your UPI.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2 gap-1.5">
                <Link href="/shop/settings">
                  View shop QR →
                </Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead className="pr-4 text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="pl-4 font-mono font-semibold text-amber-700">
                      {o.customerToken}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatINRFromPaise(o.totalAmountPaise)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild size="sm" variant="ghost" className="gap-1">
                        <Link href={`/shop/orders/${o.id}`}>
                          <FileText className="size-3.5" /> Open
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sales summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">All-time sales summary</CardTitle>
            <CardDescription className="text-xs">
              Counts every order in your shop’s history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total orders</span>
              <span className="font-mono font-semibold">
                {analytics?.orderCount.total ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Paid orders</span>
              <span className="font-mono font-semibold">
                {analytics?.orderCount.paid ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">Total revenue</span>
              <Badge className="bg-emerald-100 text-emerald-800">
                {analytics?.revenue.formatted ?? formatINRFromPaise(0)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Status breakdown</CardTitle>
            <CardDescription className="text-xs">
              Where each order sits in the lifecycle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              {analytics &&
                Object.entries(analytics.byStatus).map(([s, n]) => (
                  <div
                    key={s}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="text-muted-foreground">{s.replace(/_/g, ' ')}</span>
                    <span className="font-mono font-semibold">{n}</span>
                  </div>
                ))}
              {!analytics && (
                <p className="col-span-full text-xs text-muted-foreground">
                  Analytics unavailable.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
