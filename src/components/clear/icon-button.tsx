'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Clear design system — icon-only button.
 *
 * A 48px-square touch target (WCAG 2.5.5) that contains a single icon and
 * no visible text. The accessible name comes from the required `aria-label`
 * prop — icon-only buttons without an accessible name are a top accessibility
 * failure and the type system enforces it here.
 *
 * Three surface variants:
 *  - default    : transparent — sits on the surface, ink-coloured icon.
 *  - surface    : white rounded square with hairline border. Used when the
 *                 icon button floats over a tinted or photographed surface.
 *  - accent     : solid accent fill, white icon. Used for the single most
 *                 prominent icon action on a screen (e.g. the camera shutter).
 *
 * The icon is expected to be a Lucide node passed at the desired size
 * (typically `size-5` or `size-6`); the button does not re-size it.
 */

export type IconButtonVariant = 'default' | 'surface' | 'accent';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. Defaults to "default" (transparent). */
  variant?: IconButtonVariant;
  /** Compact 40px — for tight rows / app bars. Still meets 44px via padding. */
  compact?: boolean;
  /** The icon node (Lucide). Sized by the caller. */
  children: ReactNode;
  /**
   * Accessible name — REQUIRED. The icon carries no text, so this label is
   * the only thing screen readers announce. Enforced by the type (no
   * default), so omitting it is a compile error.
   */
  'aria-label': string;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  default: 'bg-transparent text-[var(--label)] hover:bg-[var(--fill)] active:bg-[var(--fill)]',
  surface:
    'bg-[var(--surface)] text-[var(--label)] border border-[var(--hairline)] hover:bg-[var(--fill)] active:bg-[var(--fill)]',
  accent: 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-press)] active:bg-[var(--accent-press)]',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    variant = 'default',
    compact = false,
    children,
    className = '',
    type = 'button',
    ...props
  },
  ref,
) {
  const sizeClass = compact ? 'size-11' : 'size-12';
  return (
    <button
      ref={ref}
      type={type}
      className={[
        'inline-flex items-center justify-center shrink-0',
        'rounded-full transition-colors duration-150 ease-out',
        'disabled:opacity-40 disabled:pointer-events-none',
        sizeClass,
        VARIANT_CLASSES[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  );
});

export default IconButton;
