'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Camera, AlertCircle, Keyboard } from 'lucide-react';
import { CustomerShell } from '@/components/clear/customer-shell';
import { Input } from '@/components/clear/input';

/**
 * /scan — "Scan QR" consumer tab. Point the camera at a shop's QR code and
 * go straight to that shop's upload page.
 *
 * Scanning uses the native BarcodeDetector API where available
 * (Chrome/Android). Safari/iOS and unsupported browsers get an honest
 * explainer plus the manual-entry fallback (paste the shop link or slug
 * from the poster) — no fabricated scanning states.
 *
 * Only Printelyx shop URLs/slugs are accepted: arbitrary external links
 * are rejected before navigation (open-redirect protection).
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/i;

/** Extract a shop slug from a scanned payload. Accepts
 *  - the full shop URL  (https://printelyx.cc.cd/s/my-shop or /s/my-shop)
 *  - a bare shop slug   (my-shop)
 *  Returns null for anything that is not a Printelyx shop path. */
export function extractShopSlug(payload: string): string | null {
  const raw = payload.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/^\/s\/([a-z0-9][a-z0-9-]{1,60})\/?$/i);
    if (match) return match[1].toLowerCase();
    return null; // a URL to somewhere else on the site — not a shop link
  } catch {
    // Not an absolute URL — treat as a bare slug.
    if (SLUG_PATTERN.test(raw)) return raw.toLowerCase();
    return null;
  }
}

/** Minimal, dependency-free BarcodeDetector typings (supported: Chrome,
 *  Edge, Android WebView; unsupported: Safari/iOS — feature-detected). */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === 'function' ? w.BarcodeDetector : null;
}

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'live' | 'denied' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const go = useCallback(
    (slug: string) => {
      stop();
      router.push(`/s/${slug}`);
    },
    [router, stop],
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    const Ctor = getBarcodeDetectorCtor();
    if (!Ctor) {
      setSupported(false);
      setCameraState('error');
      setCameraError('Live scanning needs a browser with BarcodeDetector support (Chrome, Edge or Android). Use manual entry below.');
      return;
    }
    setSupported(true);
    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraState('live');

      const detector = new Ctor({ formats: ['qr_code'] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          for (const code of codes) {
            const slug = extractShopSlug(code.rawValue);
            if (slug) {
              go(slug);
              return;
            }
          }
        } catch {
          // a failed frame detection is not fatal — keep scanning
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      rafRef.current = requestAnimationFrame(() => void tick());
    } catch (cause) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const name = (cause as { name?: string })?.name;
      if (name === 'NotAllowedError') {
        setCameraState('denied');
        setCameraError('Camera permission was denied. Allow camera access in your browser settings, or use manual entry below.');
      } else {
        setCameraState('error');
        setCameraError('Could not start the camera. Use manual entry below.');
      }
    }
  }, [go]);

  useEffect(() => stop, [stop]);

  const submitManual = (e?: React.FormEvent) => {
    e?.preventDefault();
    const slug = extractShopSlug(manual);
    if (!slug) {
      setManualError('That does not look like a Printelyx shop link or shop code. Paste the full link (…/s/shop-name) or the shop code.');
      return;
    }
    setManualError(null);
    go(slug);
  };

  return (
    <CustomerShell shopName="Printelyx">
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--label)]">Scan a shop QR code</h1>
      <p className="mt-1 text-base text-[var(--label-2)]">
        Point your camera at the shop&apos;s QR poster to go straight to its upload page.
      </p>

      <section className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]">
        {cameraState === 'live' ? (
          <div className="relative aspect-[4/3] w-full bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- video is a camera preview, not media content */}
            <video ref={videoRef} playsInline muted className="size-full object-cover" aria-label="Camera preview" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-[18%] inset-y-[22%] rounded-2xl border-2 border-white/80"
            />
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 bg-[var(--fill)] px-6 text-center">
            <Camera className="size-10 text-[var(--label-3)]" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-sm text-[var(--label-2)]">
              {cameraState === 'starting'
                ? 'Starting the camera…'
                : cameraState === 'denied'
                  ? 'Camera access is off.'
                  : 'The camera is off.'}
            </p>
            <button
              type="button"
              onClick={() => void startCamera()}
              disabled={cameraState === 'starting'}
              className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
            >
              {cameraState === 'starting' ? 'Starting…' : 'Open Scanner'}
            </button>
            <p className="text-xs text-[var(--label-3)]">
              Aim at the shop&apos;s QR poster — the shop page opens by itself.
            </p>
          </div>
        )}
      </section>

      {cameraError && (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-[var(--label-2)]" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {cameraError}
        </p>
      )}

      <section className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--label)]">
          <Keyboard className="size-4 text-[var(--label-2)]" aria-hidden="true" />
          Or enter the shop code
        </h2>
        <form className="mt-3 flex flex-col gap-3" onSubmit={submitManual}>
          <Input
            id="scan-manual"
            label="Shop link or code"
            value={manual}
            onChange={setManual}
            placeholder="printelyx.cc.cd/s/my-shop  —  or  my-shop"
            autoComplete="off"
            inputMode="url"
          />
          {manualError && (
            <p className="text-[13px] text-[var(--label-2)]" role="alert">{manualError}</p>
          )}
          <button
            type="submit"
            className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-[var(--accent-tint)] px-5 text-sm font-semibold text-[var(--accent-tint-text)]"
          >
            Open shop page
          </button>
        </form>
        <p className="mt-3 text-xs text-[var(--label-3)]">
          Every Printelyx shop page lives at <span className="font-mono">/s/&lt;shop-code&gt;</span> — the
          code is printed under the QR code on the shop poster.
        </p>
      </section>

      <p className="mt-4 text-[13px] text-[var(--label-2)]">
        No poster around? <Link href="/find-a-shop" className="underline">Find shops near you</Link> instead.
      </p>
    </CustomerShell>
  );
}
