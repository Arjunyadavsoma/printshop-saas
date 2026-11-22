'use client';

import { type ReactNode } from 'react';

/**
 * AppBar — the top bar of every customer screen.
 *
 * Shop name + open/closed indicator (a registration-mark dot, not a plain
 * circle). No hamburger menu. Optional: language switch, help link.
 *
 * The AppBar is quiet chrome — Muted colours, thin border, no decoration.
 * The content below it is the loud part.
 */

interface AppBarProps {
  /** The shop name (or screen title). */
  title: string;
  /** Optional subtitle (e.g. "B&W ₹2 · Colour ₹8 /page"). */
  subtitle?: ReactNode;
  /** Open/closed status — shows a coloured dot + text. */
  status?: 'open' | 'closed';
  /** Back button (renders if provided). */
  onBack?: () => void;
  /** Right-side actions (language switch, help). */
  actions?: ReactNode;
}

const statusConfig = {
  open: { dot: 'bg-[var(--color-success)]', label: 'Open' },
  closed: { dot: 'bg-[var(--color-error)]', label: 'Closed' },
} as const;

export function AppBar({ title, subtitle, status, onBack, actions }: AppBarProps) {
  return (
    <header
      className="sticky top-0 z-10 bg-[var(--color-paper)] border-b border-[var(--color-border-ink)] safe-top"
      role="banner"
    >
      <div className="flex items-center gap-3 px-4 min-h-[56px]">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            className="touch-target flex items-center justify-center -ml-2 text-[var(--color-ink)]"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Registration mark — the printer's alignment cross-hair */}
            {status && (
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={`size-2 rounded-full ${statusConfig[status].dot}`} aria-hidden="true" />
                <span className="text-xs text-[var(--color-muted)]">{statusConfig[status].label}</span>
              </span>
            )}
            <h1 className="text-base font-semibold text-[var(--color-ink)] truncate">{title}</h1>
          </div>
          {subtitle && (
            <p className="text-xs text-[var(--color-muted)] truncate mt-0.5 tnum">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-1 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
