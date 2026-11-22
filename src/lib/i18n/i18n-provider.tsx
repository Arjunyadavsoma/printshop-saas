'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { messages, type Locale, type MessageKey } from './messages';

/**
 * i18n context — provides the current locale + a `t()` function.
 *
 * The locale is persisted to localStorage + the <html lang> attribute is
 * updated so screen readers use the correct pronunciation engine.
 *
 * On first visit (no saved locale), the browser language is detected via
 * `navigator.language`. If it starts with 'hi' → Hindi, 'te' → Telugu,
 * else English.
 */

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('hi')) return 'hi';
  if (lang.startsWith('te')) return 'te';
  return 'en';
}

function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const entry = messages[key];
  if (!entry) return key;
  let str: string = entry[locale] ?? entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem('printshop_locale') as Locale | null;
    if (saved && ['en', 'hi', 'te'].includes(saved)) {
      setLocaleState(saved);
    } else {
      setLocaleState(detectBrowserLocale());
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('printshop_locale', l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback for components outside the provider — returns English.
    return {
      locale: 'en',
      setLocale: () => {},
      t: (key, vars) => translate('en', key, vars),
    };
  }
  return ctx;
}
