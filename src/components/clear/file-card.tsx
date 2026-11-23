'use client';

import { AlertCircle, FileText, RotateCcw, X } from 'lucide-react';

/**
 * Clear design system — file card.
 *
 * One uploaded file in the queue: a 56px thumbnail/icon, filename +
 * metadata (size, page count, status), an upload progress bar while
 * uploading/converting, an inline error row with Retry on failure, and a
 * remove (X) affordance on the right.
 *
 * Surface fill + 14px card radius (--radius-card) + hairline border. The
 * card is a flex row so it stays compact on a 360px viewport.
 *
 * Failure is never silent: the card gets a danger border, an AlertCircle
 * glyph, the error message in plain text, and a Retry button. The remove
 * (X) button is always available — even on a failed file — so the
 * customer is never stuck.
 */

export type FileCardStatus = 'uploading' | 'converting' | 'ready' | 'failed';

export interface FileCardFile {
  name: string;
  size: number;
  /** Page count, if known. */
  pageCount?: number;
  status: FileCardStatus;
  /** 0–100 — only meaningful while uploading/converting. */
  progress?: number;
  /** Plain-language failure reason. */
  error?: string;
  /** Optional object URL or remote URL for an image thumbnail. */
  thumbnailUrl?: string;
}

export interface FileCardProps {
  file: FileCardFile;
  onRemove: () => void;
  onRetry?: () => void;
  /** Optional className passthrough. */
  className?: string;
  /** When true, render with an accent ring (the row is the active file). */
  selected?: boolean;
}

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

export function FileCard({ file, onRemove, onRetry, className = '', selected = false }: FileCardProps) {
  const failed = file.status === 'failed';
  const inProgress = file.status === 'uploading' || file.status === 'converting';
  const progress = Math.max(0, Math.min(100, file.progress ?? 0));

  return (
    <div
      className={[
        'flex items-center gap-3 p-3',
        'bg-[var(--surface)]',
        'rounded-[var(--radius-card)]',
        'border transition-colors',
        failed
          ? 'border-[var(--danger)]'
          : selected
            ? 'border-[var(--accent)]'
            : 'border-[var(--hairline)]',
        className,
      ].join(' ')}
      role="group"
      aria-label={`File ${file.name}, ${STATUS_LABELS[file.status]}`}
    >
      <Thumbnail file={file} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--label)] truncate">
          {file.name}
        </p>
        <p className="text-[13px] text-[var(--label-2)] tnum mt-0.5 truncate">
          {formatSize(file.size)}
          {file.pageCount != null ? ` · ${file.pageCount} pages` : ''}
          {` · ${STATUS_LABELS[file.status]}`}
        </p>

        {inProgress && (
          <div
            className="mt-2 h-1.5 w-full rounded-full bg-[var(--track)] overflow-hidden"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${STATUS_LABELS[file.status]} progress`}
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {failed && (
          <div className="mt-2 flex items-start gap-2">
            <AlertCircle
              className="size-4 shrink-0 mt-0.5 text-[var(--danger-text)]"
              aria-hidden="true"
            />
            <p className="text-[13px] text-[var(--danger-text)] leading-relaxed flex-1 min-w-0">
              {file.error || 'Upload failed'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-1.5 px-2 -mr-1 -my-0.5 min-h-[40px] rounded-full text-[13px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-tint)] active:bg-[var(--accent-tint)] transition-colors"
                aria-label={`Retry upload of ${file.name}`}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center justify-center size-10 -mr-1 text-[var(--label-2)] hover:bg-[var(--fill)] active:bg-[var(--fill)] rounded-full transition-colors"
        aria-label={`Remove file ${file.name}`}
      >
        <X className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

function Thumbnail({ file }: { file: FileCardFile }) {
  if (file.thumbnailUrl) {
    return (
      <div
        className="size-14 shrink-0 rounded-[var(--radius-thumb)] overflow-hidden border border-[var(--hairline)] bg-[var(--fill)]"
        aria-hidden="true"
      >
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
      className="size-14 shrink-0 rounded-[var(--radius-thumb)] flex items-center justify-center bg-[var(--fill)] border border-[var(--hairline)] text-[var(--label-3)]"
      aria-hidden="true"
    >
      <FileText className="size-6" strokeWidth={2} />
    </div>
  );
}

export { FileCard as ClearFileCard };
export default FileCard;
