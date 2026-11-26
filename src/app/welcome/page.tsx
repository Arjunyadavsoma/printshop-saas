'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';
import { hasCompletedOnboarding } from '@/lib/auth/onboarding-flag';

/**
 * SCREEN 1 — Printelyx splash.
 *
 * Full-screen coral background, wordmark + tagline, floating balloon
 * decorations (reference image 1).
 *
 * Navigation (all using EXISTING mechanisms — no new auth logic):
 *   1. Wait for the shared AuthContext to become `ready` (it reads the
 *      real persisted token — localStorage or the native bridge).
 *   2. Authenticated users are routed by their EXISTING role:
 *      admin → /admin, owner/staff → /shop/dashboard.
 *      NOTE: we only trust the stored role to pick the landing route; the
 *      actual API calls still enforce auth server-side. If the token is
 *      expired, the destination page's existing gate handles it.
 *   3. Unauthenticated users who already completed onboarding → home `/`.
 *   4. New users → `/onboarding`.
 *
 * The splash is also the PWA/Android entry: it shows instantly (no data
 * fetching) and hands off in ~1.4s, reduced-motion safe.
 */

type Dest = { to: string } | null;

export default function WelcomePage() {
  const router = useRouter();
  const { token, role, ready } = useApiClient();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Minimum display time so the branding moment is perceptible.
    const MIN_MS = 1200;
    const shownAt = Date.now();

    let dest: Dest = null;
    if (ready) {
      if (token) {
        // Authenticated — route by existing role (customer → home).
        dest = { to: role === 'admin' ? '/admin' : role === 'customer' ? '/' : '/shop/dashboard' };
      } else if (hasCompletedOnboarding()) {
        dest = { to: '/' };
      } else {
        dest = { to: '/onboarding' };
      }
    }

    if (!dest) return; // wait for ready
    const remaining = Math.max(0, MIN_MS - (Date.now() - shownAt));
    const go = () => {
      setExiting(true);
      // Let the exit animation run before the route change.
      setTimeout(() => router.replace(dest!.to), 380);
    };
    const t = setTimeout(go, remaining);
    return () => clearTimeout(t);
  }, [ready, token, role, router]);

  return (
    <div data-auth>
      <div className={`au-splash${exiting ? ' au-splash-exit' : ''}`} role="status" aria-label="Printelyx">
        {/* Balloon decorations (reference style) — inline SVG, no requests */}
        <svg className="au-splash-balloon b1" width="64" height="110" viewBox="0 0 64 110" fill="none" aria-hidden="true">
          <ellipse cx="32" cy="28" rx="24" ry="28" fill="#FFFFFF" />
          <path d="M32 56 C 28 66, 38 74, 32 84 C 28 92, 34 98, 31 106" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
        <svg className="au-splash-balloon b2" width="70" height="120" viewBox="0 0 70 120" fill="none" aria-hidden="true">
          <ellipse cx="35" cy="31" rx="26" ry="31" fill="#FFFFFF" />
          <path d="M35 62 C 30 72, 42 80, 35 90 C 31 98, 37 104, 34 114" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
        <svg className="au-splash-balloon au-splash-b3" width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" style={{ position: 'absolute', top: '22%', right: '18%' }}>
          <circle cx="13" cy="13" r="13" fill="#FFFFFF" opacity="0.35" />
        </svg>
        <svg className="au-splash-balloon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{ position: 'absolute', top: '58%', left: '16%' }}>
          <circle cx="9" cy="9" r="9" fill="#FFFFFF" opacity="0.28" />
        </svg>
        <svg className="au-splash-balloon" width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true" style={{ position: 'absolute', top: '36%', right: '30%' }}>
          <circle cx="17" cy="17" r="17" fill="#FFFFFF" opacity="0.16" />
        </svg>

        {/* Wordmark + tagline */}
        <div style={{ textAlign: 'center', padding: '0 32px' }}>
          <div className="au-splash-logo">Printelyx</div>
          <div className="au-splash-tag">Your documents. Printed nearby.</div>
        </div>

        {/* Subtle loading indicator (reference has none; this is a small
            affordance that the app is deciding where to go) */}
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" style={{ position: 'absolute', bottom: 'max(48px, env(safe-area-inset-bottom))' }}>
          <circle cx="14" cy="14" r="11" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" fill="none" />
          <path d="M14 3 a11 11 0 0 1 11 11" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 14 14" to="360 14 14" dur="0.9s" repeatCount="indefinite" />
          </path>
        </svg>
      </div>
    </div>
  );
}
