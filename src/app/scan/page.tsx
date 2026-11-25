'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Camera, AlertCircle, Keyboard } from 'lucide-react';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { SiteFooter } from '@/components/clear/site-footer';
import jsQR from 'jsqr';

/**
 * /scan — "Scan QR" consumer tab. Clear design (matches homepage).
 * Point the camera at a shop's QR code and go straight to its upload page.
 * Decoding uses jsQR (pure JS, canvas frame grab). Manual-entry fallback
 * for denied camera permission and desktop use.
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

  /* ── Camera card (shared) ── */
  const cameraCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg' : 'g'} style={{ padding: 0, overflow: 'hidden' }}>
      {cameraState === 'live' ? (
        <div style={{ position: 'relative', aspectRatio: '4/3', width: '100%', background: '#000' }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- camera preview */}
          <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} aria-label="Camera preview" />
          <div aria-hidden="true" style={{ position: 'absolute', left: '18%', right: '18%', top: '22%', bottom: '22%', border: '2px solid rgba(255,255,255,0.8)', borderRadius: 16, pointerEvents: 'none' }} />
        </div>
      ) : (
        <div style={{ aspectRatio: '4/3', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#F2F3F7', padding: 24, textAlign: 'center' }}>
          <Camera style={{ width: 40, height: 40, color: '#6B6F76' }} strokeWidth={1.5} aria-hidden="true" />
          <p style={{ fontSize: 14, color: '#5B5F66' }}>
            {cameraState === 'starting' ? 'Starting the camera…' : cameraState === 'denied' ? 'Camera access is off.' : 'The camera is off.'}
          </p>
          <button type="button" onClick={() => void startCamera()} disabled={cameraState === 'starting'} className="btn" style={{ flex: 'none', height: 44, fontSize: 15, padding: '0 24px' }}>
            {cameraState === 'starting' ? 'Starting…' : 'Open Scanner'}
          </button>
          <p style={{ fontSize: 13, color: '#6B6F76' }}>Aim at the shop&apos;s QR poster — the shop page opens by itself.</p>
        </div>
      )}
    </div>
  );

  /* ── Manual entry card (shared) ── */
  const manualCard = (isDesktop = false) => (
    <div className={isDesktop ? 'gg p' : 'g p'}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#1C1C1E' }}>
        <Keyboard style={{ width: 16, height: 16, color: '#5B5F66' }} aria-hidden="true" />
        Or enter the shop code
      </h2>
      <form style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={submitManual}>
        <label htmlFor="scan-manual" style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>Shop link or code</label>
        <input
          id="scan-manual"
          className="in"
          type="text"
          placeholder="printelyx.cc.cd/s/my-shop  —  or  my-shop"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          autoComplete="off"
          inputMode="url"
        />
        {manualError && <p className="cap" role="alert" style={{ color: '#9C1F18', margin: 0 }}>{manualError}</p>}
        <button type="submit" className="btn s" style={{ flex: 'none', height: 44, fontSize: 15 }}>{'Open shop page'}</button>
      </form>
      <p className="cap" style={{ margin: '12px 0 0' }}>
        Every Printelyx shop page lives at <span style={{ fontFamily: 'ui-monospace, monospace' }}>/s/&lt;shop-code&gt;</span> — the code is printed under the QR code on the shop poster.
      </p>
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <div className="x m">
        <div className="top"><i className="dot" /><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Scan a shop QR code</h1>
        <p className="sub">Point your camera at the shop&apos;s QR poster to go straight to its upload page.</p>
        {cameraCard()}
        {cameraError && (
          <p className="cap" role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#5B5F66' }}>
            <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            {cameraError}
          </p>
        )}
        {manualCard()}
        <p className="cap">No poster around? <Link href="/find-a-shop" style={{ color: '#0A58D6', textDecoration: 'none' }}>Find shops near you</Link> instead.</p>
        <div style={{ height: 'calc(80px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Desktop */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <span className="v">
            <Link href="/" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Home</Link>
            <Link href="/track" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Track order</Link>
            <Link href="/help" style={{ color: '#5B5F66', textDecoration: 'none' }}>Help</Link>
          </span>
        </div>
        <div className="wrap"><div className="l" style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 className="h1">Scan a shop QR code</h1>
          <p className="s2">Point your camera at the shop&apos;s QR poster to go straight to its upload page.</p>
          {cameraCard(true)}
          {cameraError && (
            <p className="cap" role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#5B5F66' }}>
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              {cameraError}
            </p>
          )}
          {manualCard(true)}
          <p className="cap">No poster around? <Link href="/find-a-shop" style={{ color: '#0A58D6', textDecoration: 'none' }}>Find shops near you</Link> instead.</p>
        </div></div>
        <SiteFooter />
      </div>

      <ConsumerTabBar />
    </>
  );
}
