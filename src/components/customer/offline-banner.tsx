'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { WifiOff } from 'lucide-react';

/**
 * OfflineBanner — a thin banner pinned above the AppBar when the device
 * drops offline.
 *
 * Warning-coloured fill, ink text, a wifi-off icon, and a one-line
 * reassurance that the in-progress draft is safe. Sticky at the very top
 * of the viewport so it stays visible while the customer scrolls.
 *
 * Controlled: the parent passes `online` (typically the result of
 * listening to `window` `online`/`offline` events + `navigator.onLine`).
 * When `online` flips to false the banner slides DOWN into view; when it
 * flips back to true it slides UP and out (exit animation via
 * AnimatePresence).
 *
 * Reduced motion: under `prefers-reduced-motion`, the slide is replaced
 * with a plain fade so there's no large-area motion.
 */

interface OfflineBannerProps {
  /** Whether the device is currently online. `false` shows the banner. */
  online: boolean;
}

export function OfflineBanner({ online }: OfflineBannerProps) {
  const reduceMotion = useReducedMotion();

  // Full motion: collapse/expand height so the AppBar below shifts smoothly.
  // Reduced motion: fade only — no large-area slide.
  const variants = {
    initial: reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 },
    animate: reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 },
    exit: reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 },
  };

  return (
    <AnimatePresence initial={false}>
      {!online && (
        <motion.div
          key="offline-banner"
          role="status"
          aria-live="polite"
          initial="initial"
          animate="animate"
          exit="exit"
          variants={variants}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className={[
            // Pinned above the AppBar; safe-area aware for notched devices.
            'sticky top-0 z-20 w-full overflow-hidden',
            'bg-[var(--color-warning)] text-[var(--color-ink)] safe-top',
          ].join(' ')}
        >
          <div className="flex items-center gap-2 px-4 py-2 min-h-[44px]">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium leading-snug">
              You&rsquo;re offline. Your draft is saved &mdash; reconnect to continue.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
