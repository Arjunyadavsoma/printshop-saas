'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * Clear design system — toast.
 *
 * A transient feedback snackbar. Bottom-anchored, sitting just above the
 * PriceBar. Slides up + fades in on mount. `aria-live="polite"` so screen
 * readers announce it without interrupting.
 *
 * Controlled: the parent owns open/close. Pass a `message` to show, pass
 * an empty string (or omit) to hide — the component renders nothing when
 * there is no message. Auto-dismisses after `duration` ms (default 4s);
 * tapping anywhere on the toast dismisses it early.
 *
 * Variants:
 *  - success — success-tint + success-text check icon
 *  - error   — danger-tint  + danger-text alert icon
 *  - info    — accent-tint  + accent-tint-text info icon
 *
 * Reduced motion: the slide collapses to a fade only.
 */

type ToastVariant = 'success' | 'error' | 'info';

export interface ToastProps {
  variant: ToastVariant;
  /** The message to show. Empty string → render nothing. */
  message: string;
  /** Auto-dismiss delay in ms. Defaults to 4000. */
  duration?: number;
  /** Called when the toast auto-dismisses or is tapped. Parent closes it. */
  onDismiss: () => void;
}

interface VariantConfig {
  Icon: typeof Check;
  bgClass: string;
  borderClass: string;
  accentClass: string;
}

const VARIANT_CONFIG: Record<ToastVariant, VariantConfig> = {
  success: {
    Icon: Check,
    bgClass: 'bg-[var(--success-tint)]',
    borderClass: 'border-[var(--success-tint)]',
    accentClass: 'text-[var(--success-text)]',
  },
  error: {
    Icon: AlertCircle,
    bgClass: 'bg-[var(--danger-tint)]',
    borderClass: 'border-[var(--danger-tint)]',
    accentClass: 'text-[var(--danger-text)]',
  },
  info: {
    Icon: Info,
    bgClass: 'bg-[var(--accent-tint)]',
    borderClass: 'border-[var(--accent-tint)]',
    accentClass: 'text-[var(--accent-tint-text)]',
  },
};

export function Toast({ variant, message, duration = 4000, onDismiss }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [message, duration]);

  const { Icon, bgClass, borderClass, accentClass } = VARIANT_CONFIG[variant];

  // Animation: slide up from 16px + fade. Reduced motion → fade only.
  const variants = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 },
  };

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          role="status"
          aria-live="polite"
          initial="initial"
          animate="animate"
          exit="exit"
          variants={variants}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={[
            'fixed left-1/2 -translate-x-1/2 z-30 w-full max-w-sm px-4',
            // Clear the PriceBar (~72px) + iOS home indicator.
            'bottom-[calc(80px+env(safe-area-inset-bottom))]',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={onDismiss}
            className={[
              'w-full flex items-center gap-3 text-left',
              'rounded-[var(--radius-card)] border',
              'px-4 py-3 min-h-[48px]',
              'shadow-[var(--shadow-pop)]',
              bgClass,
              borderClass,
            ].join(' ')}
          >
            <Icon className={`size-5 shrink-0 ${accentClass}`} aria-hidden="true" />
            <span className="flex-1 text-sm text-[var(--label)] leading-snug">
              {message}
            </span>
            <X className="size-4 shrink-0 text-[var(--label-2)]" aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { Toast as ClearToast };
export default Toast;
