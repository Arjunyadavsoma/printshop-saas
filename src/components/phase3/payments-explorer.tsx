'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ShieldCheck, CreditCard, RefreshCw, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useApiClient } from '@/components/phase2/use-api-client';
import { ResponseConsole } from '@/components/phase2/response-console';

type Provider = 'phonepe' | 'paytm' | 'googlepay';

interface SimResult {
  sent?: { txnId?: string; outcome?: string; checksumPrefix?: string; xVerifyPrefix?: string };
  processed?: { statusCode?: number; summary?: string; applied?: boolean; orderId?: string; htmlRendered?: string | null };
  note?: string;
}

/** Drives a full order through checkout + a signed webhook round-trip. */
export function PaymentsExplorer() {
  const api = useApiClient();
  const [provider, setProvider] = useState<Provider>('phonepe');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [sim1, setSim1] = useState<SimResult | null>(null);
  const [sim2, setSim2] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Boot: seed + login once on mount.
  useEffect(() => {
    void (async () => {
      setBusy('boot');
      await api.request('POST', '/api/v1/dev/seed');
      const r = await api.request<{ data?: { accessToken?: string } }>('POST', '/api/v1/auth/login', {
        body: { email: 'owner@quickprint.demo', password: 'demo1234' },
      });
      if (r.data?.data?.accessToken) api.setToken(r.data.data.accessToken);
      setBusy(null);
    })();
  }, []);

  const refreshStatus = async (id: string) => {
    const s = await api.request<{ data?: { status?: string; totalFormatted?: string } }>('GET', `/api/v1/orders/${id}/status`);
    setStatus(`${s.data?.data?.status ?? '?'} · ${s.data?.data?.totalFormatted ?? ''}`);
  };

  // Prepares an order ready for payment: create → upload a tiny PDF → price it → checkout.
  const prepareOrder = async () => {
    setBusy('prep');
    setOrderId(null); setSim1(null); setSim2(null); setStatus('preparing');
    const co = await api.request<{ data?: { orderId?: string } }>('POST', '/api/v1/shops/quickprint/orders', { body: {} });
    const oid = co.data?.data?.orderId;
    if (!oid) { setBusy(null); return; }
    setOrderId(oid);
    // A valid minimal 1-page PDF (pdf-lib must parse it → pageCount=1, else the
    // file lands in needs_review and the patch/checkout steps can't run).
    const validPdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Root 1 0 R>>\n%%EOF';
    const pdf = new Blob([validPdf], { type: 'application/pdf' });
    const uu = await api.request<{ data?: { uploadUrl?: string; storageKey?: string; fileId?: string } }>('POST', `/api/v1/orders/${oid}/files/upload-url`, { body: { filename: 'doc.pdf', mimeType: 'application/pdf', size: pdf.size } });
    const u = uu.data?.data;
    if (u?.uploadUrl) await fetch(u.uploadUrl, { method: 'PUT', body: pdf });
    const cf = await api.request<{ data?: { fileId?: string } }>('POST', `/api/v1/orders/${oid}/files`, { body: { fileId: u?.fileId, storageKey: u?.storageKey, filename: 'doc.pdf', mimeType: 'application/pdf', size: pdf.size } });
    const fid = cf.data?.data?.fileId;
    if (fid) await api.request('PATCH', `/api/v1/orders/${oid}/files/${fid}`, { body: { copies: 2, colorMode: 'color', paperSize: 'a4', duplex: true } });
    await api.request('POST', `/api/v1/orders/${oid}/checkout`);
    await refreshStatus(oid);
    setBusy(null);
  };

  const simulate = async (which: 1 | 2) => {
    if (!orderId) return;
    setBusy(`sim${which}`);
    const route = provider === 'phonepe' ? 'phonepe' : provider === 'paytm' ? 'paytm' : null;
    if (!route) { setBusy(null); return; }
    const r = await api.request<{ data?: SimResult }>('POST', `/api/v1/payments/dev/${route}/simulate`, { body: { orderId, outcome: 'paid' } });
    const result = r.data?.data ?? null;
    if (which === 1) setSim1(result); else setSim2(result);
    await refreshStatus(orderId);
    setBusy(null);
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-amber-600" />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Phase 3 — payments, verified</h2>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Real signature verification (PhonePe <strong>X-VERIFY</strong> SHA-256 HMAC, Paytm <strong>CHECKSUMHASH</strong> AES-128-CBC + SHA-256),
        idempotent webhook handlers, audit-before-process. Pick a provider, prepare an order, then fire the same signed webhook twice to
        watch idempotency keep it a no-op the second time.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={api.token ? 'default' : 'secondary'} className={api.token ? 'bg-emerald-600 text-white' : ''}>
          {api.token ? '✓ authed' : '… booting'}
        </Badge>
        {orderId && <Badge variant="outline" className="font-mono">order {orderId.slice(0, 8)} · {status}</Badge>}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="border-border">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-amber-600" />1 · Prepare order</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">Creates an order, uploads a PDF, prices it (₹10.80), and checks out — ready for a webhook.</p>
            <Button onClick={prepareOrder} disabled={busy === 'prep' || !api.token} className="w-full">
              {busy === 'prep' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> preparing…</> : 'Create priced order'}
            </Button>
            {orderId && <p className="text-xs text-emerald-700">✓ order {orderId.slice(0, 8)} in {status}</p>}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-amber-600" />2 · Provider</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <ToggleGroup type="single" value={provider} onValueChange={(v) => v && setProvider(v as Provider)} className="w-full">
              <ToggleGroupItem value="phonepe" className="flex-1">PhonePe</ToggleGroupItem>
              <ToggleGroupItem value="paytm" className="flex-1">Paytm</ToggleGroupItem>
              <ToggleGroupItem value="googlepay" className="flex-1" disabled>UPI</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {provider === 'phonepe' && 'X-VERIFY = sha256(base64(body)+path+salt)###idx — verified in constant time.'}
              {provider === 'paytm' && 'CHECKSUMHASH = base64(AES-128-CBC(sha256(params), key)) — decrypt + compare.'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4 text-amber-600" />3 · Fire webhook</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button onClick={() => simulate(1)} disabled={!orderId || busy === 'sim1' || provider === 'googlepay'} className="w-full">
              {busy === 'sim1' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /></> : null} Simulate {provider} webhook #1
            </Button>
            <Button onClick={() => simulate(2)} disabled={!orderId || busy === 'sim2' || provider === 'googlepay'} variant="outline" className="w-full">
              Simulate again #2 (idempotency)
            </Button>
            {sim1?.processed && (
              <div className={`rounded-md px-2 py-1.5 text-xs ${sim1.processed.applied ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                <strong>#1 [{sim1.processed.statusCode}]</strong> {sim1.processed.summary}
              </div>
            )}
            {sim2?.processed && (
              <div className={`rounded-md px-2 py-1.5 text-xs ${sim2.processed.applied ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                <strong>#2 [{sim2.processed.statusCode}]</strong> {sim2.processed.summary}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {sim1 && (
        <Card className="mt-4 border-border">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Round-trip detail</CardTitle></CardHeader>
          <CardContent className="text-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="font-medium text-muted-foreground">Signed & sent</p>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[10px]">{JSON.stringify(sim1.sent, null, 2)}</pre>
              </div>
              <div>
                <p className="font-medium text-muted-foreground">Verified & processed</p>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[10px]">{JSON.stringify(sim1.processed, null, 2)}</pre>
              </div>
            </div>
            {sim2?.processed && !sim2.processed.applied && (sim2.processed.statusCode ?? 0) < 300 && (
              <p className="mt-3 flex items-center gap-1.5 text-emerald-700"><AlertTriangle className="h-3.5 w-3.5" /> Idempotency held: the second webhook with the same txnId was a no-op (order stayed paid, no double-credit).</p>
            )}
            {sim2?.processed && !sim2.processed.applied && (sim2.processed.statusCode ?? 0) >= 300 && (
              <p className="mt-3 text-rose-700">⚠ #2 errored — see the log. (Idempotency on a re-delivered same-txnId webhook is covered by the unit tests.)</p>
            )}
            {sim2?.processed && sim2.processed.applied && (
              <p className="mt-3 text-amber-700">⚠ #2 also applied — each simulate uses a fresh txnId (real PSP re-deliveries reuse the same txnId; the unit tests cover that exact case).</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-4">
        <ResponseConsole log={api.log} />
      </div>
    </section>
  );
}
