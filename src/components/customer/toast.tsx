'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';

/**
 * Toast — a transient feedback snackbar.
 *
 * Bottom-anchored, sitting just above the StickyActionBar. Slides up +
 * fades in on mount (via tw-animate-css). `aria-live="polite"` so screen
 * readers announce it without interrupting.
 *
 * Controlled: the parent owns open/close. Pass a `message` to show, pass
 * an empty string (or omit) to hide — the component renders `null` when
 * there is no message. Auto-dismisses after `duration` ms (default 4s);
 * tapping anywhere on the toast dismisses it early.
 *
 * Variants:
 *   success — success-colour tint + checkmark icon
 *   error   — error-colour tint + alert icon
 *   info    — cyan-ink tint + info icon
 *
 * Reduced motion: the entrance animation is clamped to ~0ms by the global
 * `prefers-reduced-motion` rule in globals.css, so the toast simply
 * appears. No layout shift either way (it's position: fixed).
 */

type ToastVariant = 'success' | 'error' | 'info';

interface ToastProps {
  variant: ToastVariant;
  /** The message to show. Empty/null → render nothing. */
  message: string;
  /** Auto-dismiss delay in ms. Defaults to 4000. */
  duration?: number;
  /** Called when the toast auto-dismisses or is tapped. Parent closes it. */
  onDismiss: () => void;
}

interface VariantConfig {
  Icon: typeof Check;
  /** Tailwind class producing a 12% tint of the status colour over surface. */
  bgClass: string;
  /** Border at ~30% status colour. */
  borderClass: string;
  /** Icon + accent colour (full-strength status token). */
  accentClass: string;
}

const VARIANT_CONFIG: Record<ToastVariant, VariantConfig> = {
  success: {
    Icon: Check,
    bgClass: 'bg-[color-mix(in_srgb,var(--color-success)_12%,var(--color-surface))]',
    borderClass: 'border-[rgb(11_122_75_/_0.35)]',
    accentClass: 'text-[var(--color-success)]',
  },
  error: {
    Icon: AlertCircle,
    bgClass: 'bg-[color-mix(in_srgb,var(--color-error)_12%,var(--color-surface))]',
    borderClass: 'border-[rgb(179_38_30_/_0.35)]',
    accentClass: 'text-[var(--color-error)]',
  },
  info: {
    Icon: Info,
    bgClass: 'bg-[color-mix(in_srgb,var(--color-cyan-ink)_12%,var(--color-surface))]',
    borderClass: 'border-[rgb(0_111_166_/_0.35)]',
    accentClass: 'text-[var(--color-cyan-ink)]',
  },
};

export function Toast({ variant, message, duration = 4000, onDismiss }: ToastProps) {
  // Keep the latest onDismiss in a ref so the auto-dismiss timer does not
  // reset on every parent re-render (parents rarely memoise the callback).
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timer);
    // Only re-arm when the message or duration changes — not on onDismiss churn.
  }, [message, duration]);

  // Render nothing while there is no message (controlled component).
  if (!message) return null;

  const { Icon, bgClass, borderClass, accentClass } = VARIANT_CONFIG[variant];

  return (
    <div
      // Live region: announce the message politely (no interruption).
      role="status"
      aria-live="polite"
      className={[
        // Fixed above the sticky bar, centred, capped width on large screens.
        'fixed left-1/2 -translate-x-1/2 z-30 w-full max-w-sm px-4',
        // Clear the StickyActionBar (~80px) plus the iOS home indicator.
        'bottom-[calc(88px+env(safe-area-inset-bottom))]',
        // Entrance: slide up + fade in. Reduced-motion clamps this globally.
        'animate-in fade-in-0 slide-in-from-bottom-4 duration-300',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onDismiss}
        // No aria-label: the message text is the button's accessible name,
        // which is also what the polite live region announces. (Setting an
        // aria-label here would hide the message from the a11y tree and the
        // live region would announce nothing.)
        className={[
          'w-full flex items-center gap-3 text-left',
          'rounded-[var(--radius-default)] border',
          'px-4 py-3 min-h-[48px] touch-target',
          'shadow-[var(--shadow-slip)]',
          bgClass,
          borderClass,
        ].join(' ')}
      >
        <Icon className={`size-5 shrink-0 ${accentClass}`} aria-hidden="true" />
        <span className="flex-1 text-sm text-[var(--color-ink)] leading-snug">
          {message}
        </span>
        <X className="size-4 shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
      </button>
    </div>
  );
}
