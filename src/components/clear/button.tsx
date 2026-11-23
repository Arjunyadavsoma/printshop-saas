'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Clear design system — buttons.
 *
 * Four variants, each with a distinct visual role:
 *  - Primary      : solid accent fill, fully rounded, 52px tall (compact 44).
 *                   One per screen — this is the main forward action.
 *  - Tinted       : accent-tint background with accent-tint-text. Secondary
 *                   affirmative action (e.g. "Add another file").
 *  - Destructive  : surface background with danger text + 1px hairline border.
 *                   Used for cancel / remove — never a solid red fill.
 *  - Text         : transparent background, accent text. Tertiary inline action.
 *
 * Loading state preserves the button's width by swapping the label for a
 * same-width invisible label + spinner overlay, so the layout never shifts
 * when a request is in flight.
 *
 * The global `*:focus-visible` rule in globals.css paints a 2px accent ring
 * with offset on every focusable element, so we do not add per-component
 * focus styles here.
 *
 * Touch targets: default 52px, compact 44px (WCAG 2.5.5). 16px+ text so
 * iOS Safari does not zoom on tap.
 */

export type ClearButtonVariant = 'primary' | 'tinted' | 'destructive' | 'text';
export type ClearButtonSize = 'default' | 'compact';

export interface ClearButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. Defaults to "primary". */
  variant?: ClearButtonVariant;
  /** "default" = 52px tall, "compact" = 44px tall. */
  size?: ClearButtonSize;
  /** Shows a spinner and disables the button. Preserves width. */
  loading?: boolean;
  /** Optional leading icon (Lucide). */
  leadingIcon?: ReactNode;
  /** Optional trailing icon (Lucide). */
  trailingIcon?: ReactNode;
  /** Button label. Required — Clear buttons always have visible text. */
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ClearButtonVariant, string> = {
  primary: [
    'bg-[var(--accent)] text-[var(--on-accent)]',
    'hover:bg-[var(--accent-press)] active:bg-[var(--accent-press)]',
  ].join(' '),
  tinted: [
    'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]',
    'hover:brightness-95 active:brightness-90',
  ].join(' '),
  destructive: [
    'bg-[var(--surface)] text-[var(--danger)] border border-[var(--hairline)]',
    'hover:bg-[var(--fill)] active:bg-[var(--fill)]',
  ].join(' '),
  text: [
    'bg-transparent text-[var(--accent)]',
    'hover:bg-[var(--accent-tint)] active:bg-[var(--accent-tint)]',
  ].join(' '),
};

const SIZE_CLASSES: Record<ClearButtonSize, string> = {
  // 52px tall, 17px text, weight 600 — the primary action spec.
  default: 'min-h-[52px] px-6 text-[17px] font-semibold gap-2',
  // 44px compact — for dense rows, in-card actions.
  compact: 'min-h-[44px] px-4 text-[15px] font-semibold gap-1.5',
};

export const ClearButton = forwardRef<HTMLButtonElement, ClearButtonProps>(
  function ClearButton(
    {
      variant = 'primary',
      size = 'default',
      loading = false,
      leadingIcon,
      trailingIcon,
      disabled,
      children,
      className = '',
      type = 'button',
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={[
          'relative inline-flex items-center justify-center text-center',
          'rounded-full select-none whitespace-nowrap',
          'transition-colors duration-150 ease-out',
          'disabled:opacity-50 disabled:pointer-events-none',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        ].join(' ')}
        {...props}
      >
        {loading ? (
          <>
            {/* Invisible label reserves the same width as the real label,
                so the button never narrows when the spinner swaps in. */}
            <span className="invisible inline-flex items-center gap-2" aria-hidden="true">
              {leadingIcon}
              {children}
              {trailingIcon}
            </span>
            {/* Spinner absolutely centred over the reserved label slot. */}
            <span className="absolute inline-flex items-center justify-center" aria-hidden="true">
              <Loader2 className="size-5 animate-spin" />
            </span>
          </>
        ) : (
          <>
            {leadingIcon && (
              <span className="shrink-0 inline-flex" aria-hidden="true">
                {leadingIcon}
              </span>
            )}
            <span>{children}</span>
            {trailingIcon && (
              <span className="shrink-0 inline-flex" aria-hidden="true">
                {trailingIcon}
              </span>
            )}
          </>
        )}
      </button>
    );
  },
);

/** Solid accent button — the primary forward action on a screen. */
export const PrimaryButton = forwardRef<HTMLButtonElement, Omit<ClearButtonProps, 'variant'>>(
  function PrimaryButton(props, ref) {
    return <ClearButton ref={ref} variant="primary" {...props} />;
  },
);

/** Accent-tint button — secondary affirmative action. */
export const TintedButton = forwardRef<HTMLButtonElement, Omit<ClearButtonProps, 'variant'>>(
  function TintedButton(props, ref) {
    return <ClearButton ref={ref} variant="tinted" {...props} />;
  },
);

/** Surface + danger text + hairline border — cancel / remove. */
export const DestructiveButton = forwardRef<HTMLButtonElement, Omit<ClearButtonProps, 'variant'>>(
  function DestructiveButton(props, ref) {
    return <ClearButton ref={ref} variant="destructive" {...props} />;
  },
);

/** Transparent + accent text — tertiary inline action. */
export const TextButton = forwardRef<HTMLButtonElement, Omit<ClearButtonProps, 'variant'>>(
  function TextButton(props, ref) {
    return <ClearButton ref={ref} variant="text" {...props} />;
  },
);

export { ClearButton as Button };
