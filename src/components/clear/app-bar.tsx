'use client';

import { type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * AppBar — top bar for customer-facing pages.
 * Shop name + open/closed dot + optional back button + actions.
 * Frosted, sticky, safe-area aware.
 */
interface AppBarProps {
  title: string;
  subtitle?: ReactNode;
  status?: 'open' | 'closed';
  onBack?: () => void;
  actions?: ReactNode;
}

export function AppBar({ title, subtitle, status, onBack, actions }: AppBarProps) {
  return (
    <header
      className="sticky top-0 z-10 frosted-bar border-b border-[var(--hairline)] safe-top"
      role="banner"
    >
      <div className="flex items-center gap-3 px-5 min-h-[56px]">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            className="touch-target flex items-center justify-center -ml-2 text-[var(--label)]"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {status && (
              <span className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`size-2 rounded-full ${status === 'open' ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`}
                  aria-hidden="true"
                />
                <span className="text-[12px] font-medium text-[var(--label-2)]">
                  {status === 'open' ? 'Open' : 'Closed'}
                </span>
              </span>
            )}
            <div className="text-[15px] font-semibold text-[var(--label)] truncate">{title}</div>
          </div>
          {subtitle && (
            <p className="text-[14px] text-[var(--label-2)] truncate mt-0.5 tnum">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
