'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { StatusBadge } from '@/components/portal/status-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  ShieldCheck,
  PackageCheck,
  XCircle,
  Check,
  Settings as SettingsIcon,
  QrCode,
  Sparkles,
  Plus,
  Terminal,
  Cpu,
  ArrowRight,
} from 'lucide-react';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import {
  checkPrintLatchStatus,
} from '@/lib/printlatch/client';
import {
  checkNativePrinterStatus,
  getEnginePref,
  type PrintEngine,
} from '@/lib/native-printer/client';
import { toast } from 'sonner';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  address: string;
  phone: string;
  isActive: boolean;
  description: string | null;
  hasUpiQr?: boolean;
  servicesJson: string | null;
  paymentPhone: string | null;
  upiQrStorageKey: string | null;
}

interface OrderRow {
  id: string;
  customerToken: string;
  tokenNumber?: string | null;
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
  customerPhone?: string | null;
  notes?: string | null;
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
  } catch { return false; }
}

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return '—'; }
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
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Printer-engine status for the "Choose your print engine" callout. The
  // shopkeeper picks between PrintLatch + Native Windows Printer on the
  // /shop/printer page; here we just surface whether they've picked yet.
  const [printerEngine, setPrinterEngine] = useState<PrintEngine | null | undefined>(undefined);
  const [printerConnected, setPrinterConnected] = useState(false);

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
    const id = setInterval(() => void load(true), 15_000);
    return () => clearInterval(id);
  }, []);

  // Check the printer-engine status once on mount — surfaces the
  // "Choose your print engine" callout if the shopkeeper hasn't set up
  // a printer yet. Both checks are best-effort + run in parallel.
  useEffect(() => {
    let cancelled = false;
    const engine = getEnginePref();
    setPrinterEngine(engine);
    if (engine === 'printlatch') {
      checkPrintLatchStatus().then((s) => {
        if (!cancelled) setPrinterConnected(s.state === 'connected');
      });
    } else if (engine === 'native') {
      checkNativePrinterStatus().then((s) => {
        if (!cancelled) setPrinterConnected(s.state === 'connected');
      });
    }
    return () => { cancelled = true; };
  }, []);

  const todays = useMemo(() => {
    const todaysOrders = orders.filter((o) => isToday(o.createdAt));
    const todaysPaid = todaysOrders.filter(
      (o) => o.status !== 'awaiting_payment' && o.status !== 'cancelled',
    );
    const revenuePaise = todaysPaid.reduce((acc, o) => acc + o.totalAmountPaise, 0);
    return {
      total: todaysOrders.length,
      newOrders: todaysOrders.length,
      awaitingPayment: todaysOrders.filter((o) => o.status === 'awaiting_payment').length,
      awaitingPrinting: todaysOrders.filter((o) => o.status === 'paid').length,
      printing: todaysOrders.filter((o) => o.status === 'printing').length,
      ready: todaysOrders.filter((o) => o.status === 'ready').length,
      completed: todaysOrders.filter((o) => o.status === 'collected').length,
      revenue: revenuePaise,
    };
  }, [orders]);

  // ── Queues ──
  const paymentQueue = useMemo(
    () => orders.filter((o) => o.status === 'awaiting_payment'),
    [orders],
  );
  const readyQueue = useMemo(
    () => orders.filter((o) => o.status === 'ready'),
    [orders],
  );
  const printingQueue = useMemo(
    () => orders.filter((o) => o.status === 'printing'),
    [orders],
  );

  // ── Setup checklist ──
  const checklist = useMemo(() => {
    return [
      {
        key: 'profile',
        label: 'Shop profile filled',
        done: Boolean(shop?.name && shop?.address),
        href: '/shop/settings',
      },
      {
        key: 'services',
        label: 'Services selected',
        done: Boolean(shop?.servicesJson && shop.servicesJson !== '[]'),
        href: '/shop/settings',
      },
      {
        key: 'upi',
        label: 'UPI ID configured',
        done: Boolean(shop?.upiId),
        href: '/shop/settings',
      },
      {
        key: 'upi-qr',
        label: 'UPI QR uploaded',
        done: Boolean(shop?.hasUpiQr || shop?.upiQrStorageKey),
        href: '/shop/settings',
      },
    ];
  }, [shop]);
  const checklistDone = checklist.filter((c) => c.done).length;
  const checklistPct = (checklistDone / checklist.length) * 100;

  const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);
  const anyAgentOnline = agents.some((a) => a.isOnline);

  // ── Quick action: verify/reject payment ──
  const quickVerify = async (orderId: string, action: 'verify' | 'reject') => {
    setVerifyBusy(orderId);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/verify-payment`,
        { body: { action } },
      );
      if (r.status >= 400) {
        const msg = r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`;
        setActionError(msg);
        toast.error(
          action === 'verify' ? 'Could not verify payment' : 'Could not reject payment',
          { description: msg },
        );
        return;
      }
      // Success — give the shopkeeper clear feedback that the payment status
      // was updated. Without this, the order just silently disappears from
      // the queue (the `load(true)` refresh re-computes paymentQueue) and
      // the shopkeeper has no confirmation that the click landed.
      if (action === 'verify') {
        toast.success('✓ Payment verified', {
          description: 'Order marked as paid. The customer will see the update on their tracking page.',
        });
      } else {
        toast.success('Payment rejected', {
          description: 'Order marked as cancelled. The customer will see "rejected" on their tracking page.',
        });
      }
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setActionError(msg);
      toast.error('Network error', { description: msg });
    } finally {
      setVerifyBusy(null);
    }
  };

  // ── Quick action: mark ready ──
  const quickReady = async (orderId: string) => {
    setVerifyBusy(orderId);
    setActionError(null);
    try {
      const r = await api.request<{ error?: { message?: string } }>(
        'POST',
        `/api/v1/shops/me/orders/${orderId}/ready`,
      );
      if (r.status >= 400) {
        setActionError(r.data?.error?.message ?? `Action failed (HTTP ${r.status}).`);
        return;
      }
      await load(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setVerifyBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48 sm:w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-base text-rose-800">Couldn't load the dashboard</CardTitle>
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
    { label: "Today's orders", value: String(todays.total), icon: Inbox, tone: 'text-amber-700', bg: 'bg-amber-50' },
    { label: 'New', value: String(todays.newOrders), icon: Sparkles, tone: 'text-sky-700', bg: 'bg-sky-50' },
    { label: 'Awaiting payment', value: String(todays.awaitingPayment), icon: Clock, tone: 'text-amber-700', bg: 'bg-amber-50' },
    { label: 'Printing', value: String(todays.printing), icon: PrinterIcon, tone: 'text-amber-700', bg: 'bg-amber-50' },
    { label: 'Ready for pickup', value: String(todays.ready), icon: PackageCheck, tone: 'text-emerald-700', bg: 'bg-emerald-50' },
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
              {shop ? `slug: ${shop.slug} · today's overview` : 'Overview of today\'s activity'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href="/shop/settings"><QrCode className="size-4" /> My QR</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="gap-1.5"
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Install-prompt banner (Chrome/Edge/Android: native install button;
          iOS Safari: "Add to Home Screen" instructions). Dismissible. */}
      <InstallPrompt />

      {/* Printer-engine callout — surfaces the 2 print methods so the
          shopkeeper knows they need to pick one before they can print.
          Hidden once they've connected a printer. */}
      {printerEngine !== undefined && !(printerEngine && printerConnected) && (
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <PrinterIcon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {printerEngine === null
                      ? 'Choose your print engine to start printing'
                      : 'Finish setting up your printer'}
                  </h2>
                  <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800 text-[10px]">
                    Setup needed
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  PrintShop supports two print engines. Pick the one that fits your shop — you can switch any time.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {/* Method 1: PrintLatch */}
                  <div className={`rounded-lg border p-3 ${printerEngine === 'printlatch' ? 'border-amber-400 bg-amber-50' : 'border-border bg-card'}`}>
                    <div className="flex items-center gap-2">
                      <Terminal className="size-4 text-amber-600" />
                      <span className="text-sm font-medium text-foreground">PrintLatch</span>
                      <Badge variant="outline" className="ml-auto border-emerald-300 bg-emerald-50 text-emerald-700 text-[9px]">Recommended</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      One-click installer. Auto-starts on Windows boot. No coding required.
                    </p>
                  </div>
                  {/* Method 2: Native Windows Printer */}
                  <div className={`rounded-lg border p-3 ${printerEngine === 'native' ? 'border-amber-400 bg-amber-50' : 'border-border bg-card'}`}>
                    <div className="flex items-center gap-2">
                      <Cpu className="size-4 text-zinc-600" />
                      <span className="text-sm font-medium text-foreground">Native Windows Printer</span>
                      <Badge variant="outline" className="ml-auto border-zinc-300 bg-zinc-50 text-zinc-600 text-[9px]">Advanced</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Node.js service. Direct GDI printing. Terminal must stay open.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="mt-3 gap-1.5 bg-amber-600 text-white hover:bg-amber-700 min-h-[44px]">
                  <Link href="/shop/printer">
                    {printerEngine === null ? 'Choose your engine' : 'Finish setup'}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
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

      {/* Setup checklist + today's revenue */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-amber-600" /> Setup checklist
            </CardTitle>
            <CardDescription className="text-xs">
              Complete these to unlock the full shopkeeper experience.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={checklistPct} className="h-2" />
            <ul className="space-y-1.5">
              {checklist.map((c) => (
                <li key={c.key}>
                  <Link
                    href={c.href}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <span className={`flex size-4 items-center justify-center rounded-full border ${
                        c.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border'
                      }`}>
                        {c.done && <Check className="size-3" />}
                      </span>
                      <span className={c.done ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">{c.done ? 'Done' : 'Open →'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-900">
              <IndianRupee className="size-4" /> Today's sales
            </CardTitle>
            <CardDescription className="text-emerald-800 text-xs">
              From {todays.total} orders · paid orders only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tracking-tight text-emerald-900">
              {formatINRFromPaise(todays.revenue)}
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              Completed: {todays.completed} · Ready: {todays.ready} · Printing: {todays.printing}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Agent banner */}
      <Card
        className={`border-l-4 ${anyAgentOnline ? 'border-l-emerald-400 bg-emerald-50/50' : 'border-l-amber-400 bg-amber-50/50'}`}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            {anyAgentOnline ? <Wifi className="size-5 text-emerald-600" /> : <WifiOff className="size-5 text-amber-600" />}
            <div>
              <p className="text-sm font-medium">
                {anyAgentOnline ? 'Print agent online' : 'No print agent connected — manual downloads still work'}
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

      {/* Payment queue */}
      <Card className="border-amber-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-amber-600" /> Payment queue
            <Badge variant="outline" className="ml-auto bg-amber-50 text-amber-800">{paymentQueue.length}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Orders waiting for you to confirm the customer's UPI payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {paymentQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
              <CheckCircle2 className="size-6 text-emerald-600" />
              <p className="text-sm font-medium">All caught up</p>
              <p className="text-xs text-muted-foreground">No orders are awaiting payment verification.</p>
            </div>
          ) : (
            paymentQueue.slice(0, 6).map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3"
              >
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-amber-700">{o.tokenNumber ?? o.customerToken}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(o.createdAt)}</span>
                  </div>
                  <Separator />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{formatINRFromPaise(o.totalAmountPaise)}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {o.customerPhone ?? 'no phone on file'}
                    </span>
                  </div>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-wrap sm:justify-end">
                  <Button asChild size="sm" variant="ghost" className="min-h-[36px] flex-1 sm:flex-initial text-[11px]">
                    <Link href={`/shop/orders/${o.id}`}>Open →</Link>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void quickVerify(o.id, 'verify')}
                    disabled={verifyBusy === o.id}
                    className="min-h-[44px] flex-1 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-initial"
                  >
                    {verifyBusy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Verify
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verifyBusy === o.id}
                        className="min-h-[44px] flex-1 gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 sm:flex-initial"
                      >
                        <XCircle className="size-3.5" /> Reject
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reject this payment?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The order will be marked cancelled. The customer will see "rejected" on their tracking page.
                          Only reject if the customer hasn't actually paid.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-rose-600 text-white hover:bg-rose-700"
                          onClick={(e) => { e.preventDefault(); void quickVerify(o.id, 'reject'); }}
                        >
                          Yes, reject
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))
          )}
          {actionError && <p className="text-xs text-rose-700">⚠ {actionError}</p>}
        </CardContent>
      </Card>

      {/* Ready-for-pickup queue */}
      <Card className="border-emerald-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="size-4 text-emerald-700" /> Ready for pickup
            <Badge variant="outline" className="ml-auto bg-emerald-50 text-emerald-800">{readyQueue.length}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Call out the token number when the customer walks in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {readyQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders ready for pickup yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {readyQueue.slice(0, 12).map((o) => (
                <Link
                  key={o.id}
                  href={`/shop/orders/${o.id}`}
                  className="flex flex-col gap-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 transition-colors hover:bg-emerald-100"
                >
                  <span className="font-mono text-xl font-bold tracking-tight text-emerald-800">
                    {o.tokenNumber ?? o.customerToken}
                  </span>
                  <span className="text-[11px] text-emerald-800">
                    {formatINRFromPaise(o.totalAmountPaise)} · {timeAgo(o.createdAt)}
                  </span>
                  {o.customerPhone && (
                    <span className="text-[10px] font-mono text-emerald-700">{o.customerPhone}</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Printing queue (compact) */}
      {printingQueue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PrinterIcon className="size-4 text-amber-600" /> Currently printing
              <Badge variant="outline" className="ml-auto bg-amber-50 text-amber-800">{printingQueue.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {printingQueue.slice(0, 8).map((o) => (
                <Link
                  key={o.id}
                  href={`/shop/orders/${o.id}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <Loader2 className="size-3 animate-spin text-amber-600" />
                  <span className="font-mono font-semibold text-amber-700">{o.tokenNumber ?? o.customerToken}</span>
                  <span className="text-[11px] text-muted-foreground">{formatINRFromPaise(o.totalAmountPaise)}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent orders */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Recent orders</CardTitle>
          <CardDescription className="text-xs">
            The last 10 orders placed at your shop. Click a row to manage prints, downloads, and status.
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
                Your shop has no orders. Share your QR code with customers so they can scan, upload, and pay directly to your UPI.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2 gap-1.5">
                <Link href="/shop/settings"><QrCode className="size-4" /> View shop QR →</Link>
              </Button>
            </div>
          ) : (
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Token</TableHead>
                  <TableHead>Payment</TableHead>
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
                      {o.tokenNumber ?? o.customerToken}
                    </TableCell>
                    <TableCell>
                      <PaymentMiniBadge status={o.status} paidAt={o.paidAt} />
                    </TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatINRFromPaise(o.totalAmountPaise)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{timeAgo(o.createdAt)}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button asChild size="sm" variant="ghost" className="gap-1">
                        <Link href={`/shop/orders/${o.id}`}><FileText className="size-3.5" /> Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All-time summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">All-time sales summary</CardTitle>
            <CardDescription className="text-xs">
              Counts every order in your shop's history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total orders</span>
              <span className="font-mono font-semibold">{analytics?.orderCount.total ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Paid orders</span>
              <span className="font-mono font-semibold">{analytics?.orderCount.paid ?? 0}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">Total revenue</span>
              <Badge className="bg-emerald-100 text-emerald-800">{analytics?.revenue.formatted ?? formatINRFromPaise(0)}</Badge>
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
              {analytics && Object.entries(analytics.byStatus).map(([s, n]) => (
                <div key={s} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5">
                  <span className="text-muted-foreground">{s.replace(/_/g, ' ')}</span>
                  <span className="font-mono font-semibold">{n}</span>
                </div>
              ))}
              {!analytics && <p className="col-span-full text-xs text-muted-foreground">Analytics unavailable.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4 text-amber-600" /> Quick actions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/shop/settings"><SettingsIcon className="size-4" /> Settings</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/shop/orders"><FileText className="size-4" /> All orders</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/shop/settings"><QrCode className="size-4" /> Shop QR</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/shop/printer"><PrinterIcon className="size-4" /> Print agent</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Separator() {
  return <span className="hidden h-8 w-px bg-border sm:inline-block" aria-hidden />;
}

function PaymentMiniBadge({ status, paidAt }: { status: string; paidAt: string | null }) {
  let cls = 'border-zinc-200 bg-zinc-50 text-zinc-700';
  let label = 'pending';
  if (status === 'awaiting_payment') { label = 'pending'; }
  else if (paidAt) { cls = 'border-emerald-200 bg-emerald-50 text-emerald-800'; label = 'paid'; }
  if (status === 'cancelled') { cls = 'border-rose-200 bg-rose-50 text-rose-700'; label = 'rejected'; }
  if (status === 'refunded') { cls = 'border-violet-200 bg-violet-50 text-violet-800'; label = 'refunded'; }
  return (
    <Badge variant="outline" className={`text-[10px] ${cls}`}>
      {label}
    </Badge>
  );
}
