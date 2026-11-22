'use client';

import { useI18n } from '@/lib/i18n/i18n-provider';
import { LOCALES } from '@/lib/i18n/messages';

/**
 * LanguageSwitcher — a compact segmented control with EN | हिंदी | తెలుగు.
 *
 * Goes in the AppBar's `actions` slot. 48px touch targets, accessible
 * (aria-label="Change language", aria-pressed on the active option).
 */
export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div
      role="group"
      aria-label="Change language"
      className="flex items-center gap-0.5 rounded-[var(--radius-tight)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-0.5"
    >
      {LOCALES.map((l) => (
        <button
          key={l.value}
          onClick={() => setLocale(l.value)}
          aria-pressed={locale === l.value}
          aria-label={l.label}
          className={[
            'touch-target min-w-[40px] px-2 text-xs font-medium rounded-[var(--radius-tight)]',
            'transition-colors duration-150',
            locale === l.value
              ? 'bg-[var(--color-cyan-ink)] text-white'
              : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]',
          ].join(' ')}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
