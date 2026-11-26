'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

/**
 * SCREEN 8 — Welcome Home / Success (reference image 8).
 *
 * Shown ONLY after a backend-confirmed authentication success (the login
 * screen forwards the REAL user email + role from the API response after
 * setAuth succeeded). Displays the actual identity, then performs the
 * same role-aware redirect the existing login uses (admin → /admin,
 * owner → /shop/dashboard). There is no fabricated success state — no
 * token means this screen bounces to /auth/login.
 */

function SuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email');
  const role = params.get('role');
  const next = params.get('next');
  const [count, setCount] = useState(3);

  const destination = next ?? (role === 'admin' ? '/admin' : '/shop/dashboard');

  useEffect(() => {
    // No confirmed identity → this screen was reached directly; do not
    // fake a success state. Send to the real login.
    if (!email) {
      router.replace('/auth/login');
      return;
    }
    const tick = setInterval(() => setCount(c => c - 1), 1000);
    const go = setTimeout(() => { router.replace(destination); }, 3000);
    return () => { clearInterval(tick); clearTimeout(go); };
  }, [email, destination, router]);

  if (!email) return null;

  return (
    <div data-auth>
      <div className="au-screen safe">
        <div className="au-col" style={{ justifyContent: 'center', textAlign: 'center', gap: 4 }}>
          {/* Check badge */}
          <div className="au-success-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <div className="au-header" style={{ paddingTop: 16 }}>
            <h1>Welcome to Printelyx</h1>
            <p>Your smarter printing experience starts here.</p>
            {email && (
              <p style={{ marginTop: 10, fontWeight: 600, color: 'var(--au-ink)', wordBreak: 'break-all' }}>
                {email}
                {role && (
                  <span style={{ display: 'inline-block', marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--au-coral-deep)', background: 'var(--au-coral-soft)', borderRadius: 999, padding: '3px 10px', verticalAlign: 'middle' }}>
                    {role}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* 3D illustration */}
          <div className="au-illustration au-success-illust" style={{ padding: '12px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static local asset */}
            <img src="/auth/success-hero.png" alt="A happy character holding up a freshly printed document" style={{ width: 'min(76%, 320px)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
            <button
              type="button"
              className="au-btn"
              onClick={() => router.replace(destination)}
            >
              Continue{count > 0 ? ` (${count})` : ''}
            </button>
            <Link href="/" className="au-link" style={{ fontSize: 13 }}>
              Browse print shops first
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}
