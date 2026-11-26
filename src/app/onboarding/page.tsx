'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, OnboardingPagination, NextButton } from '@/components/auth/auth-ui';
import { markOnboardingComplete } from '@/lib/auth/onboarding-flag';

/**
 * SCREENS 2–4 — Onboarding carousel (reference images 2–4).
 *
 * Three pages, each: 3D illustration → headline → description, with
 * pagination indicators (coral active pill) and the black circular
 * Next button in the bottom-right. The last page's button reads
 * "Get Started" (pill) and navigates to the login screen — the existing
 * authentication entry point.
 *
 * Completion sets the localStorage onboarding flag (UI preference only).
 * "Skip" jumps straight to home — the customer journey needs no account.
 */

const PAGES = [
  {
    illustration: '/auth/onboard-discover.png',
    illustrationAlt: 'A smartphone showing nearby print shops on a map',
    title: 'Find printing shops near you',
    body: 'Discover trusted printing shops around your location and get your documents printed without unnecessary travel.',
  },
  {
    illustration: '/auth/onboard-print.png',
    illustrationAlt: 'Documents flying into a printer that prints colourful pages',
    title: 'Upload. Customize. Print.',
    body: 'Upload your documents, select your printing preferences and place your order in just a few steps.',
  },
  {
    illustration: '/auth/onboard-collect.png',
    illustrationAlt: 'A happy person collecting their printed documents',
    title: 'Quality printing at great prices',
    body: 'Choose the right shop, compare prices and collect your prints when they are ready.',
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const isLast = page === PAGES.length - 1;

  const go = useCallback((next: number) => {
    setDir(next > page ? 'fwd' : 'back');
    setPage(Math.max(0, Math.min(PAGES.length - 1, next)));
  }, [page]);

  const finishToAuth = useCallback(() => {
    markOnboardingComplete();
    router.push('/auth/login');
  }, [router]);

  const skipToHome = useCallback(() => {
    markOnboardingComplete();
    router.replace('/');
  }, [router]);

  const p = PAGES[page];

  return (
    <AuthShell>
      <div className="au-onboard">
        <div
          key={page}
          className={dir === 'fwd' ? 'au-slide' : 'au-slide-back'}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <div className="au-onboard-illust">
            {/* eslint-disable-next-line @next/next/no-img-element -- static local asset */}
            <img src={p.illustration} alt={p.illustrationAlt} />
          </div>
          <div className="au-onboard-body">
            <h1>{p.title}</h1>
            <p>{p.body}</p>
          </div>
        </div>

        <div className="au-onboard-nav">
          <OnboardingPagination
            count={PAGES.length}
            active={page}
            onSelect={go}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {page > 0 && (
              <button type="button" className="au-back" onClick={() => go(page - 1)} aria-label="Previous page">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
                </svg>
              </button>
            )}
            {isLast ? (
              <button type="button" className="au-btn" style={{ width: 'auto', height: 52, padding: '0 28px', flex: 'none' }} onClick={finishToAuth}>
                Get Started
              </button>
            ) : (
              <NextButton onClick={() => go(page + 1)} />
            )}
          </div>
        </div>
      </div>

      {/* Skip — straight to the customer experience (no account needed) */}
      <div style={{ textAlign: 'center', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <button type="button" className="au-skip" onClick={skipToHome}>
          Skip — start printing
        </button>
      </div>
    </AuthShell>
  );
}
