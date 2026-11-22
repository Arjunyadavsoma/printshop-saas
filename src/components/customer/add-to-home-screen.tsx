'use client';

import { useEffect, useState } from 'react';
import { PrimaryButton, TextButton } from './button';
import { Download, X } from 'lucide-react';

/**
 * AddToHomeScreenPrompt — shows after the 2nd successful order.
 *
 * The brief says: "Add to home screen prompt after the second successful
 * order." This component checks the order count in localStorage + shows
 * a dismissible prompt to install the PWA.
 *
 * On Chrome/Edge/Android: uses the captured `beforeinstallprompt` event
 * (stored by the PWARegister component) to trigger the native install
 * dialog.
 * On iOS Safari: shows instructions to "Tap Share → Add to Home Screen"
 * (iOS doesn't support beforeinstallprompt).
 *
 * The prompt shows ONLY when:
 *   1. The customer has placed ≥ 2 orders (tracked in localStorage)
 *   2. The app is not already installed (window.matchMedia('(display-mode: standalone)'))
 *   3. The customer hasn't dismissed it before (localStorage flag)
 *   4. The beforeinstallprompt event is available (Chrome/Edge) OR the
 *      user is on iOS (show instructions)
 */

const ORDER_COUNT_KEY = 'printshop_order_count';
const DISMISSED_KEY = 'printshop_a2hs_dismissed';

// Module-level variable set by the PWARegister component's event listener.
// This is the standard pattern for capturing beforeinstallprompt.
let deferredPrompt: any = null;
export function setDeferredPrompt(e: any) { deferredPrompt = e; }

export function AddToHomeScreenPrompt() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Check if previously dismissed
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;

    // Check order count
    const count = parseInt(localStorage.getItem(ORDER_COUNT_KEY) ?? '0', 10);
    if (count < 2) return;

    // Detect iOS (no beforeinstallprompt support)
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // On non-iOS: only show if the deferred prompt is available
    // On iOS: show the instructions prompt
    if (ios || deferredPrompt) {
      // Delay 2s so it doesn't appear mid-transition
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      setShow(false);
    }
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Install PrintShop"
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 safe-bottom-bar"
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border-ink)] rounded-[var(--radius-soft)] shadow-[var(--shadow-slip)] p-4">
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 touch-target flex items-center justify-center text-[var(--color-muted)]"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <div className="flex items-start gap-3 pr-8">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)]/10">
            <Download className="size-5 text-[var(--color-cyan-ink)]" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-[var(--color-ink)]">Add to home screen</p>
            <p className="text-sm text-[var(--color-muted)]">
              {isIOS
                ? 'Tap the Share button in Safari, then "Add to Home Screen" for quick access.'
                : 'Install PrintShop for quick access to your orders and tracking.'}
            </p>
          </div>
        </div>
        {!isIOS && (
          <div className="mt-3 flex gap-2">
            <PrimaryButton size="default" onClick={handleInstall} className="flex-1">
              Install
            </PrimaryButton>
            <TextButton onClick={handleDismiss}>Not now</TextButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** Call this when an order is placed — increments the order count. */
export function incrementOrderCount() {
  const current = parseInt(localStorage.getItem(ORDER_COUNT_KEY) ?? '0', 10);
  localStorage.setItem(ORDER_COUNT_KEY, String(current + 1));
}
