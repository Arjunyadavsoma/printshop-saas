'use client';

import { useState, useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * Clear design system — accordion.
 *
 * An expandable section: a header row (title + optional subtitle + a
 * chevron) that toggles a collapsible body. Used for FAQ entries, settings
 * sections, and "more details" blocks.
 *
 * Accessibility (WAI-ARIA accordion pattern):
 *  - The header is a <button> with `aria-expanded` + `aria-controls`.
 *  - The body is a <div role="region" aria-labelledby=...> so screen readers
 *    announce it as a named region when expanded.
 *  - Space / Enter toggle natively (it's a <button>).
 *
 * Animation: the body expands/collapses via framer-motion (height auto +
 * opacity). Under `prefers-reduced-motion` it collapses to a fade only.
 *
 * Two usage modes:
 *  1. Standalone single item: `<Accordion title="...">...</Accordion>`.
 *     Self-managed open state (uncontrolled, starts collapsed).
 *  2. Controlled: pass `open` + `onToggle` to drive the state externally
 *     (e.g. inside an AccordionGroup that keeps only one item open).
 */

export interface AccordionProps {
  /** Header title. */
  title: string;
  /** Optional subtitle / context. */
  subtitle?: string;
  /** Optional leading icon (Lucide). */
  icon?: ReactNode;
  /** The expandable body. */
  children: ReactNode;
  /** Whether the accordion is open. When omitted, the component manages its own state. */
  open?: boolean;
  /** Called when the header is toggled. Receives the next open state. */
  onToggle?: (open: boolean) => void;
  /** Default open state for uncontrolled usage. Defaults to false. */
  defaultOpen?: boolean;
  /** Optional className for the wrapper. */
  className?: string;
}

export function Accordion({
  title,
  subtitle,
  icon,
  children,
  open,
  onToggle,
  defaultOpen = false,
  className = '',
}: AccordionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const reduceMotion = useReducedMotion();
  const buttonId = useId();
  const regionId = useId();

  const toggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  return (
    <div
      className={[
        'border-b border-[var(--hairline)]',
        className,
      ].join(' ')}
    >
      {/* Header row */}
      <button
        type="button"
        id={buttonId}
        aria-expanded={isOpen}
        aria-controls={regionId}
        onClick={toggle}
        className={[
          'flex items-center gap-3 w-full text-left',
          'min-h-[52px] py-3',
          'focus:outline-none',
          'transition-colors duration-150',
        ].join(' ')}
      >
        {icon && (
          <span className="shrink-0 inline-flex text-[var(--label-2)]" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-base font-medium text-[var(--label)] leading-snug truncate">
            {title}
          </span>
          {subtitle && (
            <span className="text-[13px] text-[var(--label-2)] leading-snug truncate">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronDown
          className={[
            'size-5 shrink-0 text-[var(--label-2)]',
            'transition-transform duration-200 ease-out',
            isOpen ? 'rotate-180' : 'rotate-0',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={regionId}
            role="region"
            aria-labelledby={buttonId}
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-4 text-sm text-[var(--label-2)] leading-relaxed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AccordionGroup — a stack of Accordions where only one is open at a time.
// ─────────────────────────────────────────────────────────────────────────────

export interface AccordionGroupProps {
  /** The accordion children. Each must have a unique `key`. */
  children: ReactNode;
  /** Optional className for the wrapper. */
  className?: string;
}

/**
 * AccordionGroup — a styled container for a stack of Accordions.
 *
 * Wraps Accordion children in a surface-coloured, card-radius container so
 * a set of FAQ items or settings sections reads as a single visual unit
 * with shared borders (each Accordion's bottom border doubles as the
 * divider between items).
 *
 * Single-open coordination (where opening one closes the others) is left
 * to the caller: render each Accordion in controlled mode (`open` +
 * `onToggle`) and track the open index in the parent. This keeps the
 * group composable without context wiring.
 */
export function AccordionGroup({ children, className = '' }: AccordionGroupProps) {
  return (
    <div
      className={['bg-[var(--surface)] rounded-[var(--radius-card)] px-4', className].join(' ')}
    >
      {children}
    </div>
  );
}

export { Accordion as ClearAccordion, AccordionGroup as ClearAccordionGroup };
export default Accordion;
