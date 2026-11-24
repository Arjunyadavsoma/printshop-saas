'use client';

/**
 * RvFlowParts — .rv-styled presentational pieces for the customer order
 * flow (Consumer Flow Revamp boards 2–5). Pure visuals: no state, no
 * fetches. Every component keeps the exact prop shape the flow already
 * passes, so swapping the render layer never touches business logic.
 *
 * Tokens come from the `.rv` scope (globals.css): Manrope, #F4F6F8 ground,
 * #0F172A ink, #2447F5 accent, 16px cards, 14px buttons.
 */

import { useId, useRef, type ReactNode } from 'react';
import { UploadCloud, FileText, Image as ImageIcon, X, RotateCcw, Loader2, ChevronRight } from 'lucide-react';

/* ── Step dots (top of each step) ──────────────────────────────────── */

export function RvStepDots({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-1.5 rounded-full transition-colors"
          style={{
            flex: 1,
            maxWidth: 44,
            background: i <= current ? 'var(--rv-accent)' : 'var(--rv-border)',
          }}
        />
      ))}
    </div>
  );
}

/* ── Step heading ──────────────────────────────────────────────────── */

export function RvStepHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-[27px] font-extrabold tracking-[-0.02em] text-[var(--rv-ink)]">{title}</h1>
      {sub && <p className="mt-1 text-[14px] text-[var(--rv-muted)]">{sub}</p>}
    </div>
  );
}

/* ── Upload dropzone ───────────────────────────────────────────────── */

export function RvDropzone({
  onFiles,
  accept,
  label = 'Add files to print',
  hint = 'PDF, photos or Word files',
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="rv-card flex flex-col items-center gap-3 border-dashed py-8 text-center"
      style={{ borderStyle: 'dashed', borderWidth: 2, borderColor: 'var(--rv-chip-border)' }}
    >
      <span className="rv-ic" aria-hidden="true">
        <UploadCloud className="size-5" />
      </span>
      <div>
        <p className="text-[17px] font-bold text-[var(--rv-ink)]">{label}</p>
        <p className="mt-1 text-[14px] text-[var(--rv-muted)]">{hint}</p>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <button type="button" className="rv-btn mt-1" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Add files
      </button>
    </div>
  );
}

/* ── File row (one uploaded file) ──────────────────────────────────── */

export type RvFileStatus = 'uploading' | 'uploaded' | 'converting' | 'ready' | 'failed';

export function RvFileRow({
  name,
  sizeLabel,
  pageCount,
  status,
  progress = 0,
  active = false,
  onSelect,
  onRemove,
  onRetry,
}: {
  name: string;
  sizeLabel: string;
  pageCount: number | null | undefined;
  status: RvFileStatus;
  progress?: number;
  active?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const isImage = /\.(jpe?g|png|gif|webp|heic)$/i.test(name);
  const truncated = name.length > 30 ? `${name.slice(0, 27)}…` : name;

  const statusPill =
    status === 'ready' ? (
      <span className="rv-pill">Ready</span>
    ) : status === 'failed' ? (
      <button type="button" className="rv-pill am" onClick={onRetry} style={{ cursor: onRetry ? 'pointer' : 'default' }}>
        {onRetry ? 'Retry' : 'Failed'}
      </button>
    ) : progress < 100 && status === 'uploading' ? (
      <span className="rv-pill gy">{progress}%</span>
    ) : (
      <span className="rv-pill gy">Processing</span>
    );

  const sub =
    status === 'ready'
      ? `${pageCount ?? 0} ${pageCount === 1 ? 'page' : 'pages'}, ${sizeLabel}`
      : status === 'failed'
        ? 'Could not process this file'
        : status === 'uploading' && progress < 100
          ? `Uploading… ${progress}%`
          : 'Processing…';
  return (
    <div
      className="rv-card"
      style={active ? { borderColor: 'var(--rv-accent)', borderWidth: 2 } : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      aria-pressed={onSelect ? active : undefined}
    >
      <div className="rv-r">
        <span className="rv-ic" aria-hidden="true">
          {status === 'converting' || (status === 'uploading' && progress >= 100) ? (
            <Loader2 className="size-5 animate-spin" />
          ) : isImage ? (
            <ImageIcon className="size-5" />
          ) : (
            <FileText className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold text-[var(--rv-ink)]">{truncated}</span>
          <span className="block text-[13px] text-[var(--rv-muted)]">{sub}</span>
        </span>
        <span className="flex flex-col items-end gap-2">
          {statusPill}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={`Remove ${name}`}
              className="flex size-7 items-center justify-center rounded-full text-[var(--rv-muted)] hover:bg-[var(--rv-accent-soft)]"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      </div>
      {status === 'uploading' && progress > 0 && progress < 100 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--rv-hairline)]">
          <div className="h-full rounded-full bg-[var(--rv-accent)] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

/* ── Sticky bottom bar ─────────────────────────────────────────────── */

export function RvBar({
  caption,
  total,
  action,
}: {
  caption: ReactNode;
  total: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="rv-bar mt-4">
      <div className="flex flex-1 items-center justify-between gap-3 pr-2">
        <span className="text-[13px] text-[var(--rv-muted)]">{caption}</span>
        <span className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--rv-ink)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total}
        </span>
      </div>
      {action}
    </div>
  );
}

/* ── Primary action button for RvBar (inline, .rv-btn with auto width) ── */

export function RvBarButton({
  children,
  onClick,
  disabled,
  loading,
  style,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      className="rv-btn"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      style={{ width: 'auto', minWidth: 140, paddingLeft: 22, paddingRight: 22, ...style }}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ── Preset card (options step) ────────────────────────────────────── */

export function RvPresetCard({
  name,
  description,
  priceLabel,
  selected,
  onSelect,
}: {
  name: string;
  description: string;
  priceLabel: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="rv-card text-left transition-colors"
      style={selected ? { borderColor: 'var(--rv-accent)', borderWidth: 2 } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-bold text-[var(--rv-ink)]">{name}</span>
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border-2"
          style={{
            borderColor: selected ? 'var(--rv-accent)' : 'var(--rv-chip-border)',
            background: selected ? 'var(--rv-accent)' : 'transparent',
          }}
        >
          {selected && <span className="size-1.5 rounded-full bg-white" />}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-[var(--rv-muted)]">{description}</p>
      {priceLabel && (
        <p className="mt-2 text-[15px] font-extrabold text-[var(--rv-ink)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {priceLabel}
        </p>
      )}
    </button>
  );
}

/* ── Compact summary card (active file / review rows) ─────────────── */

export function RvSummaryCard({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rv-card">
      <p className="truncate text-[15px] font-bold text-[var(--rv-ink)]">{title}</p>
      {meta && <p className="mt-1 text-[13px] text-[var(--rv-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{meta}</p>}
      {children}
    </div>
  );
}

/* ── "More options" row (opens sheet) ──────────────────────────────── */

export function RvMoreOptionsRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rv-card flex w-full items-center justify-between text-left"
    >
      <span className="text-[15px] font-bold text-[var(--rv-ink)]">{label}</span>
      <ChevronRight className="size-5 text-[var(--rv-muted)]" aria-hidden="true" />
    </button>
  );
}

/* ── Banner (error / info / warning) ───────────────────────────────── */

export function RvBanner({
  kind = 'info',
  children,
  onDismiss,
}: {
  kind?: 'info' | 'error' | 'warning';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const palette =
    kind === 'error'
      ? { bg: '#FDE8E8', ink: '#9C1F18' }
      : kind === 'warning'
        ? { bg: 'var(--rv-amber-bg)', ink: 'var(--rv-amber-ink)' }
        : { bg: 'var(--rv-accent-soft)', ink: 'var(--rv-accent)' };
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-2 rounded-[14px] px-4 py-3 text-[14px] leading-snug"
      style={{ background: palette.bg, color: palette.ink }}
    >
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex-none text-[18px] leading-none"
          style={{ color: palette.ink }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ── Labelled input (phone / name / note on review step) ───────────── */

export function RvField({
  label,
  children,
  optional = false,
}: {
  label: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-bold text-[var(--rv-ink)]">
        {label}
        {optional && <span className="ml-1 font-semibold text-[var(--rv-muted)]">(optional)</span>}
      </span>
      {children}
    </label>
  );
}

export function RvInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="h-12 w-full rounded-[14px] border bg-white px-4 text-[15px] font-semibold text-[var(--rv-ink)] outline-none"
      style={{ borderColor: 'var(--rv-chip-border)', paddingLeft: 16, ...props.style }}
    />
  );
}
