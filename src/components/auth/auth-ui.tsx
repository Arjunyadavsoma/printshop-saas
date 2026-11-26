'use client';

import { type ReactNode, type InputHTMLAttributes, useId, useState } from 'react';
import { Eye, EyeOff, Mail, Phone, User, AlertCircle, ArrowRight, ArrowLeft } from 'lucide-react';

/**
 * Printelyx auth UI kit — the eight-screen authentication experience.
 *
 * Presentation only. Every interactive screen wires these components to the
 * EXISTING API clients (AuthContext.request) — no new auth backend, no
 * mock responses. The visual language follows the supplied reference:
 * coral accent, black pill buttons, light-grey rounded inputs, 3D
 * illustrations, generous whitespace.
 *
 * Mobile-first: 390×844 reference; the AuthShell switches to a split
 * layout (form | illustration) at ≥1024px.
 */

/* ── Screen container ───────────────────────────────────────────────── */

interface AuthShellProps {
  children: ReactNode;
  /** Back button (appears top-left). Omit to hide. */
  onBack?: () => void;
  /** Desktop illustration src (right pane, ≥1024px). */
  illustration?: string;
  /** Alt text for the desktop illustration. */
  illustrationAlt?: string;
}

export function AuthShell({ children, onBack, illustration, illustrationAlt = '' }: AuthShellProps) {
  return (
    <div data-auth className="au-screen safe">
      {/* Mobile / form pane */}
      <div className={illustration ? 'au-form-pane' : ''}>
        <div className="au-col">
          {onBack && (
            <div className="au-topbar">
              <button type="button" className="au-back" onClick={onBack} aria-label="Go back">
                <ArrowLeft strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
      {/* Desktop illustration pane */}
      {illustration && (
        <div className="au-split" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- static local asset */}
          <img src={illustration} alt={illustrationAlt} />
        </div>
      )}
    </div>
  );
}

/**
 * In-column illustration. Hidden at the desktop split breakpoint when the
 * AuthShell carries a desktop `illustration` (the split pane shows it
 * instead — avoids the duplicated-illustration bug).
 */
export function AuthIllustration({ src, alt = '', hideOnDesktop = false }: { src: string; alt?: string; hideOnDesktop?: boolean }) {
  return (
    <div className="au-illustration" style={hideOnDesktop ? undefined : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static local asset */}
      <img src={src} alt={alt} className={hideOnDesktop ? 'lg:!hidden' : undefined} />
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────── */

export function AuthHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="au-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

/* ── Text field ─────────────────────────────────────────────────────── */

interface AuthTextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  icon?: 'mail' | 'phone' | 'user' | 'lock' | ReactNode;
  error?: string | null;
  hint?: string;
}

function iconFor(icon: AuthTextFieldProps['icon']): ReactNode {
  if (typeof icon !== 'string') return icon;
  switch (icon) {
    case 'mail': return <Mail strokeWidth={2} aria-hidden="true" />;
    case 'phone': return <Phone strokeWidth={2} aria-hidden="true" />;
    case 'user': return <User strokeWidth={2} aria-hidden="true" />;
    case 'lock': return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
    default: return null;
  }
}

export function AuthTextField({ label, icon, error, hint, id, ...inputProps }: AuthTextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;
  return (
    <div className="au-field">
      <label className="au-label" htmlFor={fieldId}>
        {label}<span className="req" aria-hidden="true">*</span>
      </label>
      <div className="au-input-wrap">
        {icon && <span className="au-input-icon">{iconFor(icon)}</span>}
        <input
          id={fieldId}
          className={`au-input${error ? ' au-error' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
      </div>
      {error ? (
        <span className="au-error-text" id={errorId} role="alert">
          <AlertCircle aria-hidden="true" /> {error}
        </span>
      ) : hint ? (
        <span className="au-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ── Password field (visibility toggle) ─────────────────────────────── */

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function PasswordField({ label, error, hint, id, ...inputProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="au-field">
      <label className="au-label" htmlFor={fieldId}>
        {label}<span className="req" aria-hidden="true">*</span>
      </label>
      <div className="au-input-wrap">
        <span className="au-input-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          className={`au-input${error ? ' au-error' : ''}`}
          aria-invalid={error ? true : undefined}
          autoComplete={inputProps.autoComplete ?? 'current-password'}
          {...inputProps}
        />
        <button
          type="button"
          className="au-input-action"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff strokeWidth={2} aria-hidden="true" /> : <Eye strokeWidth={2} aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <span className="au-error-text" role="alert"><AlertCircle aria-hidden="true" /> {error}</span>
      ) : hint ? (
        <span className="au-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ── Primary button ─────────────────────────────────────────────────── */

interface PrimaryAuthButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: ReactNode;
}

export function PrimaryAuthButton({ loading, children, disabled, ...btnProps }: PrimaryAuthButtonProps) {
  return (
    <button type="submit" className="au-btn" disabled={disabled || loading} aria-busy={loading || undefined} {...btnProps}>
      {loading ? <span className="au-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* ── Onboarding pagination ──────────────────────────────────────────── */

export function OnboardingPagination({
  count, active, onSelect,
}: { count: number; active: number; onSelect?: (i: number) => void }) {
  return (
    <div className="au-dots" role="tablist" aria-label="Onboarding pages">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          className={`au-dot${i === active ? ' on' : ''}`}
          aria-selected={i === active}
          aria-label={`Page ${i + 1} of ${count}`}
          onClick={() => onSelect?.(i)}
        />
      ))}
    </div>
  );
}

/* ── Divider ────────────────────────────────────────────────────────── */

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="au-divider"><span>{label}</span></div>
  );
}

/* ── Footer (swap link) ─────────────────────────────────────────────── */

export function AuthFooter({ question, actionLabel, onAction }: { question: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="au-footer">
      {question}{' '}
      <button type="button" className="au-link" onClick={onAction}>{actionLabel}</button>
    </div>
  );
}

/* ── Banner ─────────────────────────────────────────────────────────── */

export function AuthBanner({ kind, children }: { kind: 'error' | 'info'; children: ReactNode }) {
  return (
    <div className={`au-banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <AlertCircle aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ── Next (circular) button — onboarding ────────────────────────────── */

export function NextButton({ onClick, label = 'Next', disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" className="au-next" onClick={onClick} aria-label={label} disabled={disabled}>
      <ArrowRight strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
