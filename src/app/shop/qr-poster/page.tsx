'use client';

/**
 * /shop/qr-poster — spec screen 33.
 *
 * REAL QR code, not the PDF's checkerboard placeholder: GET
 * /api/v1/shops/me/qr returns a server-generated QR (qrcode lib) encoding
 * the shop's public order URL, as a PNG data URL + the URL string.
 * Download PNG uses the data URL directly; Print A4 prints the poster
 * (print CSS hides the rest of the portal).
 *
 * Opening this page marks the setup-checklist "Print your QR poster"
 * step done on this device (localStorage).
 */

import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Group, TintedButton, PrimaryButton } from '@/components/clear';
import { Download, Printer, QrCode, Copy, Check } from 'lucide-react';

const QR_DONE_KEY = 'printshop:qr-poster-done';

interface QrResponse {
  pngDataUrl?: string;
  svgString?: string;
  customerUrl?: string;
  slug?: string;
  shopName?: string;
}

export default function ShopQrPosterPage() {
  const api = useApiClient();
  const [qr, setQr] = useState<QrResponse | null>(null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'QR poster · Printelyx';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(QR_DONE_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [qrR, shopR] = await Promise.all([
        api.request<{ data?: QrResponse }>('GET', '/api/v1/shops/me/qr?format=png'),
        api.request<{ data?: { name?: string } }>('GET', '/api/v1/shops/me'),
      ]);
      if (qrR.status === 200 && qrR.data?.data) setQr(qrR.data.data);
      else if (qrR.status === 401) setError('Session expired. Please log in again.');
      else setError('Could not generate the QR code.');
      if (shopR.status === 200 && shopR.data?.data?.name) setShopName(shopR.data.data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.token) return;
    void load();
  }, [api.token, load]);

  const downloadPng = () => {
    if (!qr?.pngDataUrl) return;
    const a = document.createElement('a');
    a.href = qr.pngDataUrl;
    a.download = `${qr.slug ?? 'shop'}-qr.png`;
    a.click();
  };

  const copyUrl = async () => {
    if (!qr?.customerUrl) return;
    try {
      await navigator.clipboard.writeText(qr.customerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is visible below */
    }
  };

  const name = qr?.shopName ?? shopName ?? 'Your shop';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-[var(--label)]">QR poster</h1>
        <p className="text-sm text-[var(--label-2)]">Customers scan this to order.</p>
      </div>

      {error ? (
        <Group>
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
          <div className="mt-3">
            <TintedButton onClick={() => void load()}>Try again</TintedButton>
          </div>
        </Group>
      ) : null}

      {/* Poster — the only thing printed (see print CSS below). */}
      <div id="qr-poster" className="mx-auto w-full max-w-[420px] rounded-[24px] bg-[var(--surface)] p-8 text-center shadow-sm">
        <p className="text-xl font-bold text-[var(--label)]">{name}</p>
        <p className="mt-1 text-sm text-[var(--label-2)]">Scan to print. Pay by UPI.</p>
        <div className="mx-auto mt-6 flex size-56 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-white p-3">
          {loading ? (
            <span className="text-sm text-[var(--label-2)]">Generating QR…</span>
          ) : qr?.pngDataUrl ? (
            // The QR itself is a black-on-white code — intentionally not
            // theme-aware, so it stays scannable in dark mode too.
            <img
              src={qr.pngDataUrl}
              alt={`QR code linking to ${name}'s order page`}
              className="size-full object-contain"
              width={224}
              height={224}
            />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs text-[var(--label-2)]">
              <QrCode className="size-6" aria-hidden="true" />
              QR unavailable
            </span>
          )}
        </div>
        {qr?.customerUrl ? (
          <p className="mt-4 break-all font-mono text-xs text-[var(--label-2)]">
            {qr.customerUrl}
          </p>
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-2 sm:flex-row">
        <TintedButton onClick={downloadPng} disabled={!qr?.pngDataUrl} className="sm:flex-1">
          <Download className="size-4" aria-hidden="true" /> Download PNG
        </TintedButton>
        <PrimaryButton onClick={() => window.print()} disabled={!qr?.pngDataUrl} className="sm:flex-1">
          <Printer className="size-4" aria-hidden="true" /> Print A4
        </PrimaryButton>
      </div>
      <div className="mx-auto w-full max-w-[420px]">
        <TintedButton onClick={() => void copyUrl()} disabled={!qr?.customerUrl} className="w-full">
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy order link'}
        </TintedButton>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #qr-poster, #qr-poster * { visibility: visible !important; }
          #qr-poster {
            position: absolute !important;
            left: 0; top: 0; width: 100%; max-width: none;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}
