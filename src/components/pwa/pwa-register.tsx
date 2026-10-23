'use client';

import { useEffect } from 'react';

/**
 * BeforeInstallPromptEvent — the Chrome/Edge `beforeinstallprompt` event.
 * Not in the TS DOM lib by default, so we declare the minimal shape we use.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

/**
 * Captures the `beforeinstallprompt` event (Chrome/Edge/Android) and stores
 * it in a module-level variable so the `<InstallPrompt />` banner can call
 * `.prompt()` later when the user actually clicks "Install".
 *
 * On iOS Safari there is no `beforeinstallprompt` event — installation is a
 * manual "Share → Add to Home Screen" action. The `<InstallPrompt />`
 * component handles that case with a different message.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let hasPrompt = false;
const listeners = new Set<(e: BeforeInstallPromptEvent | null) => void>();

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function onPromptAvailable(
  cb: (e: BeforeInstallPromptEvent | null) => void,
): () => void {
  listeners.add(cb);
  // Fire immediately if we already have one.
  if (hasPrompt) cb(deferredPrompt);
  return () => {
    listeners.delete(cb);
  };
}

function notify() {
  for (const cb of listeners) cb(deferredPrompt);
}

/**
 * Registers the service worker on mount + wires up the install-prompt
 * capture. Render this once high in the tree (root layout).
 *
 * The registration is deferred until after `load` so it never blocks
 * first paint, and it only runs in production builds + browsers that
 * support service workers. In Next.js dev (`bun run dev`) the SW
 * intercepts `/_next/static/*` fetches which can cause stale-asset bugs
 * during HMR — so we skip registration in dev.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Capture the install prompt event — only Chrome/Edge/Android fire it.
    const onBIP = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      hasPrompt = true;
      notify();
    };
    window.addEventListener('beforeinstallprompt', onBIP);

    // If the app was already installed, clear any stale banner.
    const onAppInstalled = () => {
      deferredPrompt = null;
      hasPrompt = true;
      notify();
    };
    window.addEventListener('appinstalled', onAppInstalled);

    // Register the SW. Skip in Next.js dev to avoid HMR/stale-asset issues.
    if (process.env.NODE_ENV !== 'production') {
      return () => {
        window.removeEventListener('beforeinstallprompt', onBIP);
        window.removeEventListener('appinstalled', onAppInstalled);
      };
    }

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Check for updates every hour (in case the deployed SW changed).
          setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
        })
        .catch((err) => {
          // SW registration failure is non-fatal — the app still works
          // online; it just won't be installable + won't cache offline.
          console.warn('[pwa] SW registration failed:', err.message);
        });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
