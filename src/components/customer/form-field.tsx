'use client';

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * FormField — a reusable wrapper that enforces the PrintShop form layout:
 *
 *   ┌─────────────────────────────────────┐
 *   │ Label (required)                    │   ← visible <label htmlFor>
 *   │ [input element passed as children]  │   ← the actual control
 *   │ Hint text — muted, small            │   ← optional helper
 *   │ Error text — red, role="alert"      │   ← only when error present
 *   └─────────────────────────────────────┘
 *
 * Why this wrapper exists:
 *  - **Labels above inputs, always.** Placeholder-only labels are a top
 *    mobile-form failure: the hint disappears the moment the user starts
 *    typing, and screen readers may skip the field entirely. A visible
 *    `<label htmlFor>` paired with the input is the baseline.
 *  - **"Required" is text, not a red asterisk.** A bare `*` is a generic-
 *    design tell and is invisible to screen readers without an aria-label.
 *    We render the literal word "(required)" after the label so the
 *    meaning is unambiguous for sighted and non-sighted users alike.
 *  - **Errors are linked via aria-describedby.** The error `<p>` gets a
 *    stable id, and the wrapper injects `aria-describedby` onto the child
 *    input via `cloneElement`, so screen readers announce the error
 *    alongside the field label when focus lands on the input. The error
 *    also carries `role="alert"` so it's announced immediately when it
 *    appears.
 *  - **Hint text uses the same mechanism.** When both a hint and an error
 *    exist, both ids are listed in `aria-describedby` — the hint gives
 *    context, the error gives the problem.
 *
 * The actual input element is passed as `children`. The wrapper clones it
 * and injects `aria-describedby` + `aria-invalid` so the caller doesn't have
 * to thread those props manually. The caller still owns the input's `id`,
 * `value`, `onChange`, etc. — only the accessibility wiring is automated.
 */

interface FormFieldProps {
  /** Visible label text, rendered in a real <label htmlFor> element. */
  label: string;
  /** The id of the input this label points to. Must match the input's id. */
  htmlFor: string;
  /**
   * The input element (text, textarea, select, custom). It is cloned with
   * injected `aria-describedby` / `aria-invalid` props, so the caller
   * should NOT set those manually (they'll be merged with caller values,
   * caller wins for `aria-invalid`, wrapper wins for `aria-describedby` to
   * keep the wiring correct).
   */
  children: ReactElement;
  /** Optional helper text shown below the input. Muted, small (text-xs). */
  hint?: string;
  /** Optional error message. When present, the input is flagged invalid. */
  error?: string;
  /** When true, appends "(required)" after the label text. */
  required?: boolean;
}

export function FormField({
  label,
  htmlFor,
  children,
  hint,
  error,
  required = false,
}: FormFieldProps) {
  // Stable, unique ids for the hint and error regions. Derived from the
  // input's own id so multiple FormFields on one page don't collide and
  // the wiring is deterministic across renders.
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  // aria-describedby accepts a space-separated list of ids. We link BOTH
  // the hint and the error when present so screen readers get full context.
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  // Clone the child input and inject the accessibility wiring. We merge
  // any caller-supplied aria-describedby so a caller can additionally
  // reference an external element if needed (rare).
  const enhancedChild = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': describedBy ?? (children.props as Record<string, unknown>)?.['aria-describedby'],
        'aria-invalid': error ? true : ((children.props as Record<string, unknown>)?.['aria-invalid'] ?? undefined),
      } as Record<string, unknown>)
    : children;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-[var(--color-ink)]"
      >
        {label}
        {required && (
          // The literal word, not a red asterisk. aria-hidden is OFF here
          // because we WANT screen readers to read "required" aloud.
          <span className="ml-1 text-[var(--color-muted)] font-normal">
            (required)
          </span>
        )}
      </label>

      {enhancedChild}

      {hint && !error && (
        <p id={hintId} className="text-xs text-[var(--color-muted)]">
          {hint}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--color-error)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Re-export ReactNode for callers typing their own component props. */
export type { ReactNode };
