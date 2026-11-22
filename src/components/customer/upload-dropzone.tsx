'use client';

import { useCallback, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Upload } from 'lucide-react';

/**
 * UploadDropzone — the primary file entry point on the customer upload screen.
 *
 * A large dashed area that accepts both tap (mobile) and drag-and-drop
 * (desktop). When the user taps or presses Enter/Space, a hidden file input
 * is triggered. The default accept attribute covers the formats the upload
 * pipeline understands: PDF, JPG, PNG, WebP, HEIC, DOCX, PPTX, XLSX.
 *
 * Design notes:
 * - Min 200px height so the target is unmissable on a 360px viewport.
 * - Dashed border uses `--color-border-ink-strong` (20% Ink) so the area
 *   reads as "drop here" even before interaction.
 * - On dragover, the border switches to cyan-ink (the C in CMYK — our
 *   primary action colour) and the background tints paper-warm.
 * - role="button" + keyboard handler: the whole area is one control, the
 *   hidden input is aria-hidden so screen readers announce the labelled
 *   button rather than a redundant file input.
 */

const DEFAULT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.pptx,.xlsx';
const ACCEPTED_LABEL = 'PDF, JPG, PNG, WebP, HEIC, DOCX, PPTX, XLSX';

export interface UploadDropzoneProps {
  /** Called with the selected/dropped File[] (always an array, even for single picks). */
  onFiles: (files: File[]) => void;
  /** Override the accept attribute. Defaults to the supported print formats. */
  accept?: string;
  /** Disable the dropzone — greys it out and blocks input. */
  disabled?: boolean;
  /** Optional human label for accepted formats (defaults to the canonical list). */
  acceptedFormatsLabel?: string;
  /** Optional className passthrough for layout. */
  className?: string;
}

export function UploadDropzone({
  onFiles,
  accept = DEFAULT_ACCEPT,
  disabled = false,
  acceptedFormatsLabel = ACCEPTED_LABEL,
  className = '',
}: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Use a counter so nested dragenter/dragleave (child elements fire their own
  // events) don't flip the highlight off prematurely. dragleave only clears
  // when the counter hits zero.
  const dragDepth = useRef(0);
  const inputId = useId();

  const openPicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      onFiles(files);
    },
    [onFiles],
  );

  const onDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Only react to drags carrying files — ignore element drags, text
      // selections, etc. Some browsers always expose items even for non-file
      // drags, so we guard with a length check.
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!e.dataTransfer?.types?.includes('Files')) return;
      // preventDefault is REQUIRED here — without it the browser opens the
      // dropped file in a new tab instead of letting us handle it.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      handleFiles(e.dataTransfer?.files ?? null);
    },
    [disabled, handleFiles],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      // role="button" semantics: Enter or Space activates.
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openPicker();
      }
    },
    [disabled, openPicker],
  );

  // The dashed border colour toggles between strong-ink (default) and
  // cyan-ink (dragging). We use raw CSS vars so the values live in
  // globals.css and stay themeable. Background tints paper-warm while
  // dragging — a subtle warmth that signals "ready to receive".
  const borderColor = isDragging
    ? 'var(--color-cyan-ink)'
    : 'var(--color-border-ink-strong)';
  const bgClass = isDragging
    ? 'bg-[var(--color-cyan-ink)]/5'
    : 'bg-[var(--color-surface)]';

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload files to print"
      aria-disabled={disabled || undefined}
      aria-describedby={`${inputId}-formats`}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        // 200px min height — unmissable on 360px viewport.
        'min-h-[200px] w-full',
        'flex flex-col items-center justify-center text-center',
        'rounded-[var(--radius-default)]',
        'border-2 border-dashed',
        'px-6 py-8 gap-3',
        'transition-colors duration-150',
        'touch-target', // ensures the area is never sub-48px in either axis
        disabled ? 'opacity-50 pointer-events-none cursor-not-allowed' : 'cursor-pointer',
        bgClass,
        className,
      ].join(' ')}
      style={{ borderColor }}
    >
      {/* Hidden input — labelled by the button itself so screen readers
          announce "Upload files to print" once, not twice. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={accept}
        // tabIndex=-1 keeps it out of the tab order (the wrapper is the focus).
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          // Reset value so picking the same file twice fires onChange again.
          e.target.value = '';
        }}
        disabled={disabled}
      />

      {/* Upload glyph — circle chip so the icon has presence without a heavy
          container. Cyan-ink on surface, the brand's primary action colour. */}
      <span
        className="flex size-12 items-center justify-center rounded-full bg-[var(--color-cyan-ink)]/10 text-[var(--color-cyan-ink)]"
        aria-hidden="true"
      >
        <Upload className="size-6" strokeWidth={2} />
      </span>

      <p className="text-base font-medium text-[var(--color-ink)]">
        Drop files or tap to pick
      </p>

      <p
        id={`${inputId}-formats`}
        className="text-xs text-[var(--color-muted)] leading-relaxed max-w-[280px]"
      >
        {acceptedFormatsLabel}
      </p>
    </div>
  );
}
