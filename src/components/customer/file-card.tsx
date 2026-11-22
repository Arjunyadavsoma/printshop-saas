'use client';

import { type ReactNode } from 'react';
import { AlertCircle, FileText, RotateCcw, X } from 'lucide-react';

/**
 * FileCard — one uploaded file in the queue.
 *
 * Shows a thumbnail (if the file is an image the browser can render) or a
 * FileText glyph (PDF / DOCX / PPTX / XLSX). Filename, page count, and size
 * live in a tight metadata column. The upload progress bar fills cyan-ink
 * during 'uploading' / 'converting' and disappears once the file is 'ready'.
 *
 * Failure is never silent: the card gets an error border, an AlertCircle
 * glyph, the error message in plain text, and a Retry button. The remove (X)
 * button is always available — even on a failed file — so the customer is
 * never stuck.
 *
 * Surface background, default radius, 10%-ink border. The whole card is a
 * flex row so it stays compact on a 360px viewport (thumbnail 56px, copy
 * fills the rest, X button 48px touch target on the right).
 */

export type FileCardStatus = 'uploading' | 'converting' | 'ready' | 'failed';

export interface FileCardFile {
  name: string;
  size: number;
  /** Page count, if known. Undefined while still parsing. */
  pageCount?: number;
  status: FileCardStatus;
  /** 0–100 — only meaningful while status is uploading/converting. */
  progress?: number;
  /** Plain-language failure reason (shown verbatim to the customer). */
  error?: string;
  /** Optional object URL or remote URL for an image thumbnail. */
  thumbnailUrl?: string;
}

export interface FileCardProps {
  file: FileCardFile;
  onRemove: () => void;
  onRetry?: () => void;
  className?: string;
}

/** Human-readable file size — KB under 1MB, MB above. Tabular-nums elsewhere. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABELS: Record<FileCardStatus, string> = {
  uploading: 'Uploading',
  converting: 'Converting',
  ready: 'Ready',
  failed: 'Failed',
};

export function FileCard({ file, onRemove, onRetry, className = '' }: FileCardProps) {
  const failed = file.status === 'failed';
  const inProgress = file.status === 'uploading' || file.status === 'converting';
  const progress = Math.max(0, Math.min(100, file.progress ?? 0));

  return (
    <div
      className={[
        'flex items-center gap-3 p-3',
        'bg-[var(--color-surface)]',
        'rounded-[var(--radius-default)]',
        'border',
        failed
          ? 'border-[var(--color-error)]/40'
          : 'border-[var(--color-border-ink)]',
        className,
      ].join(' ')}
      role="group"
      aria-label={`File ${file.name}, ${STATUS_LABELS[file.status]}`}
    >
      {/* Thumbnail / icon — 56px square. Image thumbnails render with
          object-cover so portrait phone photos still fit. Non-image files
          get the FileText glyph on a paper-tinted chip. */}
      <Thumbnail file={file} />

      {/* Metadata column — flex-1 so it absorbs available width. Filename
          truncates with ellipsis; size + page count sit underneath in muted
          tabular nums. */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-ink)] truncate">
          {file.name}
        </p>

        <p className="text-xs text-[var(--color-muted)] tnum mt-0.5 truncate">
          {formatSize(file.size)}
          {file.pageCount != null ? ` · ${file.pageCount} pages` : ''}
          {` · ${STATUS_LABELS[file.status]}`}
        </p>

        {/* Progress bar — only while uploading or converting. The cyan-ink
            fill width is bound to progress; aria-valuenow keeps screen
            readers informed. The track is paper-warm so the fill reads as
            "more paper arrived" rather than a generic UI bar. */}
        {inProgress && (
          <div
            className="mt-2 h-1.5 w-full rounded-full bg-[var(--color-paper)] overflow-hidden"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${STATUS_LABELS[file.status]} progress`}
          >
            <div
              className="h-full rounded-full bg-[var(--color-cyan-ink)] transition-[width] duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Error state — plain text + Retry. The error string is the
            customer-facing message (we never leak stack traces here). */}
        {failed && (
          <div className="mt-2 flex items-start gap-2">
            <AlertCircle
              className="size-4 shrink-0 mt-0.5 text-[var(--color-error)]"
              aria-hidden="true"
            />
            <p className="text-xs text-[var(--color-error)] leading-relaxed flex-1 min-w-0">
              {file.error || 'Upload failed'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="touch-target inline-flex items-center justify-center gap-1.5 px-3 -mr-2 -my-1 rounded-[var(--radius-tight)] text-xs font-medium text-[var(--color-cyan-ink)] active:bg-[var(--color-cyan-ink)]/10"
                aria-label={`Retry upload of ${file.name}`}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Remove — always available. X icon, 48px touch target, aria-label
          names the file so a screen reader says "Remove file report.pdf". */}
      <button
        type="button"
        onClick={onRemove}
        className="touch-target flex items-center justify-center -mr-1 text-[var(--color-muted)] active:text-[var(--color-ink)] rounded-[var(--radius-tight)]"
        aria-label={`Remove file ${file.name}`}
      >
        <X className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Thumbnail — the 56px square on the left of the card.
 *
 * If a thumbnailUrl is provided we treat it as an image (object-cover so
 * portrait phone photos still fit). Otherwise we render the FileText glyph
 * on a paper-tinted chip — same dimensions, same visual weight, so the list
 * stays rhythmically aligned across mixed file types.
 */
function Thumbnail({ file }: { file: FileCardFile }): ReactNode {
  if (file.thumbnailUrl) {
    return (
      <div
        className="size-14 shrink-0 rounded-[var(--radius-tight)] overflow-hidden border border-[var(--color-border-ink)] bg-[var(--color-paper)]"
        // aria-hidden because the filename column already names the file.
        aria-hidden="true"
      >
        {/* Object URL — Next/Image optimization not useful for transient blob URLs. */}
        <img
          src={file.thumbnailUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className="size-14 shrink-0 rounded-[var(--radius-tight)] flex items-center justify-center bg-[var(--color-paper)] border border-[var(--color-border-ink)] text-[var(--color-muted)]"
      aria-hidden="true"
    >
      <FileText className="size-6" strokeWidth={2} />
    </div>
  );
}
