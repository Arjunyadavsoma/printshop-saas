'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Monitor, ListChecks, BarChart3, QrCode as QrIcon, Settings as SettingsIcon, Wifi, WifiOff } from 'lucide-react';
import { useApiClient } from '@/components/phase2/use-api-client';
import { useRealtime } from './use-realtime';
import { DashboardQueue } from './dashboard-queue';
import { DashboardAnalytics } from './dashboard-analytics';
import { DashboardQR } from './dashboard-qr';
import { DashboardSettings } from './dashboard-settings';

/** The shop-owner dashboard. Auto-seeds+logs in on mount, connects to the
 *  realtime mini-service via socket.io, and renders the queue live. */
export function ShopDashboard() {
  const api = useApiClient();
  const [tab, setTab] = useState('queue');
  const [refreshKey, setRefreshKey] = useState(0);

  // Boot: seed + login.
  useEffect(() => {
    void (async () => {
      await api.request('POST', '/api/v1/dev/seed');
      const r = await api.request<{ data?: { accessToken?: string } }>('POST', '/api/v1/auth/login', { body: { email: 'owner@quickprint.demo', password: 'demo1234' } });
      if (r.data?.data?.accessToken) api.setToken(r.data.data.accessToken);
    })();
  }, []);

  // Realtime: bump refreshKey on any shop event → the queue refetches.
  const rt = useRealtime(api.token, (_event, payload) => {
    const p = payload as { orderId?: string } | undefined;
    if (p?.orderId) setRefreshKey((k) => k + 1);
  });

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-center gap-2">
        <Monitor className="h-5 w-5 text-amber-600" />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Phase 5 — shop dashboard</h2>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        The shopkeeper's view: a <strong>WebSocket-driven</strong> order queue (events push the moment a customer pays or a file prints),
        per-file print/collect actions, analytics, a downloadable QR + sticker sheet, and a settings editor for pricing &amp; credentials.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={api.token ? 'default' : 'secondary'} className={api.token ? 'bg-emerald-600 text-white' : ''}>
          {api.token ? '✓ authed as owner' : '… booting'}
        </Badge>
        <Badge variant="outline" className={`gap-1 ${rt.connected ? 'text-emerald-700' : 'text-muted-foreground'}`}>
          {rt.connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {rt.connected ? (rt.authed ? 'realtime connected' : 'authenticating…') : 'realtime offline (polling)'}
        </Badge>
        {rt.lastEvent && <Badge variant="outline" className="font-mono">last: {rt.lastEvent.event}</Badge>}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="queue" className="gap-1 text-xs sm:text-sm"><ListChecks className="h-3.5 w-3.5" /> Queue</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1 text-xs sm:text-sm"><BarChart3 className="h-3.5 w-3.5" /> Analytics</TabsTrigger>
            <TabsTrigger value="qr" className="gap-1 text-xs sm:text-sm"><QrIcon className="h-3.5 w-3.5" /> QR</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1 text-xs sm:text-sm"><SettingsIcon className="h-3.5 w-3.5" /> Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="queue" className="mt-4"><DashboardQueue api={api} refreshKey={refreshKey} /></TabsContent>
          <TabsContent value="analytics" className="mt-4"><DashboardAnalytics api={api} /></TabsContent>
          <TabsContent value="qr" className="mt-4"><DashboardQR api={api} /></TabsContent>
          <TabsContent value="settings" className="mt-4"><DashboardSettings api={api} /></TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
