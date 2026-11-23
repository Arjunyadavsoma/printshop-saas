'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * PrimaryButton — the main action on a customer screen.
 *
 * Cyan-ink fill (the C in CMYK), white text. 48px minimum height (WCAG
 * 2.5.5). Loading state preserves width (no layout shift) by swapping the
 * label for a spinner of the same width.
 *
 * One primary action per screen — this is it.
 */

type Variant = 'primary' | 'secondary' | 'text';
type Size = 'default' | 'lg';

interface CustomerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** The button label. Required — buttons must have visible text (no icon-only). */
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: [
    'bg-[var(--color-cyan-ink)] text-[var(--color-on-cyan)]',
    'hover:bg-[var(--color-cyan-ink)]/90',
    'active:bg-[var(--color-cyan-ink)]/80',
    'shadow-[var(--shadow-bar)]',
  ].join(' '),
  secondary: [
    'bg-[var(--color-surface)] text-[var(--color-ink)]',
    'border border-[var(--color-border-ink)]',
    'hover:bg-[var(--color-paper)]',
    'active:bg-[var(--color-paper)]',
  ].join(' '),
  text: [
    'bg-transparent text-[var(--color-cyan-ink)]',
    'hover:bg-[var(--color-cyan-ink)]/8',
    'active:bg-[var(--color-cyan-ink)]/12',
  ].join(' '),
};

const sizeClasses: Record<Size, string> = {
  default: 'min-h-[48px] px-4 text-base gap-2',
  lg: 'min-h-[56px] px-6 text-lg gap-2.5',
};

export const CustomerButton = forwardRef<HTMLButtonElement, CustomerButtonProps>(
  ({ variant = 'primary', size = 'default', loading = false, disabled, children, className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={[
          'inline-flex items-center justify-center',
          'rounded-[var(--radius-default)]',
          'font-medium text-center',
          'transition-colors duration-150',
          'disabled:opacity-50 disabled:pointer-events-none',
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(' ')}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span className="invisible">{children}</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);

CustomerButton.displayName = 'CustomerButton';

/** Convenience aliases — same component, different default variant. */
export const PrimaryButton = forwardRef<HTMLButtonElement, Omit<CustomerButtonProps, 'variant'>>(
  (props, ref) => <CustomerButton ref={ref} variant="primary" {...props} />,
);
PrimaryButton.displayName = 'PrimaryButton';

export const SecondaryButton = forwardRef<HTMLButtonElement, Omit<CustomerButtonProps, 'variant'>>(
  (props, ref) => <CustomerButton ref={ref} variant="secondary" {...props} />,
);
SecondaryButton.displayName = 'SecondaryButton';

export const TextButton = forwardRef<HTMLButtonElement, Omit<CustomerButtonProps, 'variant'>>(
  (props, ref) => <CustomerButton ref={ref} variant="text" {...props} />,
);
TextButton.displayName = 'TextButton';
