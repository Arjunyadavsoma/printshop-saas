'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { messages, type MessageKey } from './messages';

/**
 * i18n context — English only (by decision).
 *
 * No locale switching, no browser-language detection, no localStorage.
 * The `t()` function does simple `{var}` interpolation on the flat catalog.
 *
 * This thin wrapper exists so existing components that call `useI18n().t()`
 * continue to work without per-file changes during the Clear migration.
 */

interface I18nContextValue {
  locale: 'en';
  t: (key: MessageKey | string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function translate(key: string, vars?: Record<string, string | number>): string {
  let str = messages[key as MessageKey] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const t = useCallback((key: MessageKey | string, vars?: Record<string, string | number>) => {
    return translate(key, vars);
  }, []);

  return (
    <I18nContext.Provider value={{ locale: 'en', t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return { locale: 'en', t: (key) => translate(key) };
  }
  return ctx;
}
