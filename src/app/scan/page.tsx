'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Camera, AlertCircle, Keyboard } from 'lucide-react';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { Input } from '@/components/clear/input';
import { PrimaryButton, TintedButton } from '@/components/clear/button';
import jsQR from 'jsqr';

/**
 * /scan — "Scan QR" consumer tab.
 * Point the camera at a shop's QR code and go straight to its upload page.
 * Decoding uses jsQR (pure JS, canvas frame grab). Manual-entry fallback
 * for denied camera permission and desktop use.
 *
 * Shared consumer shell (ConsumerPage) — the old `.x .m` / `.x .d` dual
 * canvas is gone. Camera logic and copy are unchanged.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/i;

export function extractShopSlug(payload: string): string | null {
  const raw = payload.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/^\/s\/([a-z0-9][a-z0-9-]{1,60})\/?$/i);
    if (match) return match[1].toLowerCase();
    return null;
  } catch {
    if (SLUG_PATTERN.test(raw)) return raw.toLowerCase();
    return null;
  }
}

const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'live' | 'denied' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const go = useCallback((slug: string) => { stop(); router.push(`/s/${slug}`); }, [router, stop]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraState('live');
      const canvas = canvasRef.current ?? document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { setCameraState('error'); setCameraError('This browser blocked canvas decoding. Use manual entry below.'); return; }
      let busy = false;
      const tick = () => {
        if (!streamRef.current || !videoRef.current) return;
        if (!busy && videoRef.current.readyState >= 2) {
          busy = true;
          const vw = videoRef.current.videoWidth || 640;
          const vh = videoRef.current.videoHeight || 480;
          const scale = Math.min(1, 640 / Math.max(vw, vh));
          canvas.width = Math.round(vw * scale);
          canvas.height = Math.round(vh * scale);
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            const slug = extractShopSlug(code.data);
            if (slug) { go(slug); return; }
          }
          busy = false;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const name = (cause as { name?: string })?.name;
      if (name === 'NotAllowedError') { setCameraState('denied'); setCameraError('Camera permission was denied. Allow camera access in your browser settings, or use manual entry below.'); }
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') { setCameraState('error'); setCameraError('No camera was found on this device. Use manual entry below.'); }
      else { setCameraState('error'); setCameraError('Could not start the camera. Use manual entry below.'); }
    }
  }, [go]);

  useEffect(() => stop, [stop]);

  const submitManual = (e?: React.FormEvent) => {
    e?.preventDefault();
    const slug = extractShopSlug(manual);
    if (!slug) { setManualError('That does not look like a Printelyx shop link or shop code. Paste the full link (…/s/shop-name) or the shop code.'); return; }
    setManualError(null);
    go(slug);
  };

  return (
    <ConsumerPage>
      <h1 className="type-hero">Scan a shop QR code</h1>
      <p className="type-sub mt-2">Point your camera at the shop&apos;s QR poster to go straight to its upload page.</p>

      {/* Camera card */}
      <div className="mt-6 overflow-hidden rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)]">
        {cameraState === 'live' ? (
          <div className="relative aspect-[4/3] w-full bg-black">
            <video ref={videoRef} playsInline muted className="size-full object-cover" aria-label="Camera preview" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-[18%] inset-y-[22%] rounded-2xl border-2 border-white/80" />
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 bg-[var(--ground)] p-6 text-center">
            <Camera className="size-10 text-[var(--label-2)]" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-sm text-[var(--label-2)]">
              {cameraState === 'starting' ? 'Starting the camera…' : cameraState === 'denied' ? 'Camera access is off.' : 'The camera is off.'}
            </p>
            <PrimaryButton type="button" size="compact" onClick={() => void startCamera()} disabled={cameraState === 'starting'}>
              {cameraState === 'starting' ? 'Starting…' : 'Open Scanner'}
            </PrimaryButton>
            <p className="text-[13px] text-[var(--label-2)]">Aim at the shop&apos;s QR poster — the shop page opens by itself.</p>
          </div>
        )}
      </div>

      {cameraError && (
        <p className="mt-4 flex items-start gap-2 px-2 text-sm text-[var(--label-2)]" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {cameraError}
        </p>
      )}

      {/* Manual entry card */}
      <div className={`${cardPadClass} mt-4`}>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--label)]">
          <Keyboard className="size-4 text-[var(--label-2)]" aria-hidden="true" />
          Or enter the shop code
        </h2>
        <form onSubmit={submitManual} className="mt-3 flex flex-col gap-3">
          <Input
            id="scan-manual"
            label="Shop link or code"
            placeholder="printelyx.cc.cd/s/my-shop  —  or  my-shop"
            value={manual}
            onChange={setManual}
            autoComplete="off"
            inputMode="url"
            error={manualError ?? undefined}
          />
          <TintedButton type="submit" size="compact">
            Open shop page
          </TintedButton>
        </form>
        <p className="mt-3 text-sm text-[var(--label-2)]">
          Every Printelyx shop page lives at <span className="font-mono">/s/&lt;shop-code&gt;</span> — the code is printed under the QR code on the shop poster.
        </p>
      </div>

      <p className="mt-4 px-2 text-sm text-[var(--label-2)]">
        No poster around? <Link href="/find-a-shop" className="text-[var(--accent)]">Find shops near you</Link> instead.
      </p>
    </ConsumerPage>
  );
}
