'use client';

import { type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { WifiOff, AlertTriangle, Info } from 'lucide-react';

/**
 * Clear design system — banner.
 *
 * A full-width banner pinned to the top of the viewport. Three variants:
 *  - "offline"  : warning fill, ink text, a wifi-off icon + a one-line
 *                 reassurance that the in-progress draft is safe. Shown
 *                 when the device drops offline (controlled by the caller).
 *  - "warning"  : warning-tint background + warning-text — a caution that
 *                 is not fatal (e.g. "Uploads will retry when you reconnect").
 *  - "info"     : accent-tint background + accent-tint-text — neutral info.
 *
 * The "offline" variant uses the solid warning fill (it must be impossible
 * to miss); "warning" and "info" use the softer tinted treatment that the
 * Clear language prefers for non-critical messaging.
 *
 * Sticky at the very top of the viewport so it stays visible while the
 * customer scrolls. `role="status"` + `aria-live="polite"` so screen
 * readers announce the banner when it appears.
 *
 * Controlled: pass `show={true}` to display. The banner animates its
 * height in / out via framer-motion so the content below shifts smoothly.
 */

export type BannerVariant = 'offline' | 'warning' | 'info';

export interface BannerProps {
  /** Which banner to render. */
  variant: BannerVariant;
  /** Whether the banner is visible. */
  show: boolean;
  /** The message text. */
  children: ReactNode;
  /** Optional className. */
  className?: string;
}

interface VariantStyle {
  /** Solid fill for offline, tinted for warning/info. */
  bgClass: string;
  textClass: string;
  Icon: typeof WifiOff;
}

const VARIANT_STYLE: Record<BannerVariant, VariantStyle> = {
  offline: {
    bgClass: 'bg-[var(--warning)] text-[var(--label)]',
    textClass: 'text-[var(--label)]',
    Icon: WifiOff,
  },
  warning: {
    bgClass: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
    textClass: 'text-[var(--warning-text)]',
    Icon: AlertTriangle,
  },
  info: {
    bgClass: 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
    textClass: 'text-[var(--accent-tint-text)]',
    Icon: Info,
  },
};

export function Banner({ variant, show, children, className = '' }: BannerProps) {
  const reduceMotion = useReducedMotion();
  const { bgClass, Icon } = VARIANT_STYLE[variant];

  // Full motion: animate height so content below shifts smoothly.
  // Reduced motion: fade only.
  const variants = {
    initial: reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 },
    animate: reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 },
    exit: reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 },
  };

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key={`banner-${variant}`}
          role="status"
          aria-live="polite"
          initial="initial"
          animate="animate"
          exit="exit"
          variants={variants}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className={[
            'sticky top-0 z-30 w-full overflow-hidden safe-top',
            bgClass,
            className,
          ].join(' ')}
        >
          <div className="flex items-center gap-2 px-4 py-2.5 min-h-[44px]">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium leading-snug">{children}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { Banner as ClearBanner };
export default Banner;
