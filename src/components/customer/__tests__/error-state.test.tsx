// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ErrorState } from '../error-state';

/**
 * P9-Security §6 — error boundary contract.
 *
 * The customer-facing ErrorState panel is the ONLY thing a customer sees
 * when a route crashes (the /o/[token]/error.tsx and /s/[shopSlug]/error.tsx
 * boundaries both render it). Three guarantees:
 *
 *   (1) It shows a friendly, specific message — never a stack trace.
 *   (2) It includes a reference code (Next.js `error.digest`) so the
 *       customer can quote it to support and the operator can find the
 *       real error in logs / Sentry.
 *   (3) It has a "Try again" button that calls `reset()`.
 *
 * The stack-trace leak is a security concern (file paths, library
 * versions, internal class names are operationally sensitive). The
 * reference code is the operator-side correlation key — short, opaque,
 * safe to paste into a support chat.
 */

describe('ErrorState — P9-Security §6 error boundary contract', () => {
  // Auto-cleanup is sometimes async under vitest+jsdom; force-clean between
  // tests so a previous render's button doesn't bleed into the next test.
  afterEach(() => { cleanup(); });

  it('renders the message + fix (never a stack trace)', () => {
    const { getByText, container } = render(
      <ErrorState
        message="We couldn't load this shop."
        fix="Check your connection and try again."
        onRetry={() => {}}
      />,
    );
    expect(getByText("We couldn't load this shop.")).toBeDefined();
    expect(getByText('Check your connection and try again.')).toBeDefined();
    // No stack trace should be rendered — the panel shows only the
    // message + fix + retry button.
    expect(container.textContent).not.toContain('at ');
    expect(container.textContent).not.toContain('Error:');
  });

  it('renders the reference code when provided', () => {
    const { getByText } = render(
      <ErrorState
        message="We couldn't load this order."
        fix="Try again."
        referenceCode="4f3a9b8c"
        onRetry={() => {}}
      />,
    );
    // The reference code is rendered verbatim so the customer can quote it.
    expect(getByText(/4f3a9b8c/)).toBeDefined();
    // The label "Reference:" prefix is present (so the customer knows what
    // the opaque string means).
    expect(getByText(/Reference:/i)).toBeDefined();
  });

  it('omits the reference line when no code is supplied', () => {
    const { container } = render(
      <ErrorState message="Error" onRetry={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/Reference:/);
  });

  it('renders a Try Again button when onRetry is provided', () => {
    const onRetry = vi.fn();
    const { getByRole } = render(
      <ErrorState message="Error" onRetry={onRetry} />,
    );
    const btn = getByRole('button', { name: /try again/i });
    expect(btn).toBeDefined();
    btn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the Try Again button when onRetry is not provided', () => {
    const { queryByRole } = render(<ErrorState message="Error" />);
    expect(queryByRole('button')).toBeNull();
  });
});
