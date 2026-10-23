'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, X, Share, Plus, CheckCircle2, Loader2 } from 'lucide-react';
import {
  onPromptAvailable,
  getDeferredPrompt,
  type BeforeInstallPromptEvent,
} from './pwa-register';

/**
 * Dismissible install-prompt banner. Shown when:
 *   1. The browser fired `beforeinstallprompt` (Chrome/Edge/Android) →
 *      show "Install app" button that calls `.prompt()`.
 *   2. The browser is iOS Safari (no `beforeinstallprompt` event) →
 *      show "Add to Home Screen" instructions (Share → Add to Home Screen).
 *
 * The dismiss state persists in localStorage so the user isn't nagged after
 * they say "Not now". The banner re-appears after 14 days (we delete the
 * dismissal key on a timer).
 *
 * Not shown:
 *   - If the app is already running in standalone mode (installed).
 *   - If the user dismissed it recently (within 14 days).
 */
const DISMISS_KEY = 'pwa_install_dismissed';
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari sets navigator.standalone; Chrome/Edge use the display-mode
  // CSS media query (also exposed via window.matchMedia).
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const notChrome = !/CriOS/.test(ua);
  return isIOS && isWebkit && notChrome;
}

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = parseInt(raw, 10);
    if (!Number.isFinite(dismissedAt)) return false;
    if (Date.now() - dismissedAt > DISMISS_TTL_MS) {
      localStorage.removeItem(DISMISS_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Don't show if already installed / standalone, or recently dismissed.
    if (isStandalone() || isDismissed()) {
      setHidden(true);
      return;
    }
    // Subscribe to the deferred-prompt events from <PWARegister />.
    const unsub = onPromptAvailable((e) => {
      setPromptEvent(e);
    });
    return unsub;
  }, []);

  // Hide after a successful install.
  useEffect(() => {
    if (installed) {
      const t = setTimeout(() => setHidden(true), 3000);
      return () => clearTimeout(t);
    }
  }, [installed]);

  const handleInstall = async () => {
    const e = getDeferredPrompt();
    if (!e) return;
    setInstalling(true);
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
      } else {
        // Dismissed — hide for 14 days so we don't nag.
        dismiss();
        setHidden(true);
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    dismiss();
    setHidden(true);
  };

  if (hidden) return null;

  // Case 1: Chrome/Edge/Android with a deferred prompt — show the install CTA.
  if (promptEvent) {
    return (
      <Card className="border-amber-200 bg-amber-50/70">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Download className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Install PrintShop on this device
              </p>
              <p className="text-[11px] text-muted-foreground">
                Open it from your home screen / Start menu — full-screen, no
                browser bar. Works offline for order lists once cached.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {installed ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="size-4" /> Installed
              </span>
            ) : (
              <Button
                size="sm"
                onClick={handleInstall}
                disabled={installing}
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700 min-h-[44px]"
              >
                {installing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {installing ? 'Installing…' : 'Install app'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-muted-foreground min-h-[44px]"
              aria-label="Dismiss install prompt"
            >
              <X className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Case 2: iOS Safari — no deferred prompt; show the manual instructions.
  if (isIOSSafari()) {
    return (
      <Card className="border-amber-200 bg-amber-50/70">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Share className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Add PrintShop to your Home Screen
              </p>
              <p className="text-[11px] text-muted-foreground">
                Tap <Share className="inline size-3 align-text-bottom" /> Share →
                <Plus className="inline size-3 align-text-bottom" /> Add to Home
                Screen. It opens full-screen like a native app.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="self-start text-muted-foreground min-h-[44px] sm:self-auto"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Other browsers without a deferred prompt — show nothing (Firefox, etc.).
  return null;
}
