'use client';

import { type ReactNode } from 'react';

/**
 * Clear design system — group.
 *
 * A white surface container with a 22px radius (--radius-group) that
 * gathers related controls or rows into a single visual unit, lifted off
 * the grey ground (--ground) by the surface fill + a soft card shadow.
 *
 * Two padding modes:
 *  - "rows"    : vertical padding 4px, horizontal 16px. For a stack of
 *               InsetList rows — the rows themselves carry 16px horizontal
 *               padding internally, so the group's 4px vertical gives them
 *               a hair of breathing room top and bottom.
 *  - "content" : uniform 16px padding. For free-form content (a form, a
 *               summary block, a single control).
 *
 * Optional title rendered as a small label-2 eyebrow above the content.
 * The title is wired to the group via `aria-labelledby` so screen readers
 * announce the group's name when focus enters it.
 *
 * Margin: the group does NOT impose outer margins — the caller controls
 * spacing between groups via the page layout (e.g. `space-y-4`).
 */

export interface GroupProps {
  /** Padding mode. "rows" = 4px 16px, "content" = 16px. Defaults to "content". */
  padding?: 'rows' | 'content';
  /** Optional eyebrow title above the content. */
  title?: string;
  /** The group's contents. */
  children: ReactNode;
  /** Optional className for layout overrides (margin, width). */
  className?: string;
  /** Optional ARIA label when no visible title is provided. */
  ariaLabel?: string;
}

export function Group({
  padding = 'content',
  title,
  children,
  className = '',
  ariaLabel,
}: GroupProps) {
  const padClass = padding === 'rows' ? 'py-1 px-4' : 'p-4';
  // When a title is provided we generate a stable-ish id by combining the
  // title text with a suffix. This is acceptable because the id only needs
  // to be unique within the document instance and titles are typically
  // distinct per group. (For guaranteed uniqueness the caller can pass
  // their own id via a wrapper.)
  const titleId = title ? `group-${slugify(title)}` : undefined;
  const groupProps = title
    ? { 'aria-labelledby': titleId }
    : ariaLabel
      ? { 'aria-label': ariaLabel }
      : {};

  return (
    <section
      className={[
        'bg-[var(--surface)]',
        'rounded-[var(--radius-group)]',
        'shadow-[var(--shadow-card)]',
        className,
      ].join(' ')}
      {...groupProps}
    >
      {title && (
        <h3
          id={titleId}
          className="px-4 pt-3 pb-1 text-[13px] font-semibold text-[var(--label-2)]"
        >
          {title}
        </h3>
      )}
      <div className={padClass}>{children}</div>
    </section>
  );
}

/** Slugify a title into a safe HTML id fragment. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export { Group as ClearGroup };
export default Group;
