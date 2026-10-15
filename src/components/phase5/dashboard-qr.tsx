'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, QrCode, Loader2 } from 'lucide-react';
import type { useApiClient } from '@/components/phase2/use-api-client';

export function DashboardQR({ api }: { api: ReturnType<typeof useApiClient> }) {
  const [png, setPng] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const r = await api.request<{ data?: { pngDataUrl?: string; svgString?: string; customerUrl?: string } }>('GET', '/api/v1/shops/me/qr');
      if (r.data?.data) { setPng(r.data.data.pngDataUrl ?? null); setSvg(r.data.data.svgString ?? null); setUrl(r.data.data.customerUrl ?? null); }
      setLoading(false);
    })();
  }, [api]);

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> generating QR…</div>;

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><QrCode className="h-4 w-4 text-amber-600" /> Shop customer QR</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          {png && <img src={png} alt="Shop QR" className="w-44 rounded-lg bg-white p-2 ring-1 ring-border" />}
          {url && <code className="rounded bg-muted px-2 py-1 font-mono text-[10px]">{url}</code>}
          <p className="text-center text-xs text-muted-foreground">Customers scan this to open your shop's mobile upload page. Print stickers, stick them at the counter & on bags.</p>
          <div className="flex flex-wrap gap-2">
            {png && <a href={png} download="shop-qr.png"><Button size="sm" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> PNG</Button></a>}
            {svg && <a href={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} download="shop-qr.svg"><Button size="sm" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> SVG</Button></a>}
            <a href="/api/v1/shops/me/sticker" download><Button size="sm" variant="default"><Download className="mr-1.5 h-3.5 w-3.5" /> Sticker PDF (A4)</Button></a>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">The sticker PDF is a real A4 with 6 QR stickers, generated server-side via pdf-lib — print, cut, stick.</p>
    </div>
  );
}
