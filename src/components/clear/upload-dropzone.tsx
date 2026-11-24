'use client';

import { useCallback, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import type { CapturedDocument } from '@/types/native-app';

/**
 * Clear design system — upload dropzone.
 *
 * A large dashed-surface area that accepts both tap (mobile) and drag-
 * and-drop (desktop). On tap or Enter/Space a hidden file input is
 * triggered. The default `accept` covers the formats the upload pipeline
 * understands: PDF, JPG, PNG, WebP, HEIC, DOCX, PPTX, XLSX.
 *
 * Visual language:
 *  - Surface fill (--surface), hairline dashed border.
 *  - On dragover: border switches to accent + the fill tints accent-tint.
 *  - A 56px accent-tint circle holds the UploadCloud glyph — the only
 *    "loud" element, signalling the primary affordance.
 *  - 200px min height so the target is unmissable on a 360px viewport.
 *
 * Accessibility:
 *  - role="button" + tabIndex so the whole area is one keyboard focus.
 *  - Enter / Space triggers the file picker.
 *  - The hidden input is aria-hidden so screen readers announce the
 *    labelled button once, not twice.
 */

const DEFAULT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.pptx,.xlsx';
const ACCEPTED_LABEL = 'PDF, JPG, PNG, WebP, HEIC, DOCX, PPTX, XLSX';

/** Convert a native camera capture (base64) into a File for the upload flow. */
function base64ToFile(shot: CapturedDocument): File {
  const binary = atob(shot.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], shot.filename, { type: shot.mimeType });
}

export interface UploadDropzoneProps {
  /** Called with the selected/dropped File[] (always an array). */
  onFiles: (files: File[]) => void;
  /** Override the accept attribute. */
  accept?: string;
  /** Disable the dropzone. */
  disabled?: boolean;
  /** Optional formats label. */
  acceptedFormatsLabel?: string;
  /** Optional className passthrough. */
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
  const dragDepth = useRef(0);
  const inputId = useId();

  const openPicker = useCallback(() => {
    if (disabled) return;
    // In the companion app, use the native document scanner (CameraX with
    // the proper runtime-permission prompt and auto-rotate EXIF handling)
    // instead of the WebView file input. A null result — cancelled, or
    // permission denied — falls through to the file input, whose Android
    // chooser still offers Camera and Files, so the flow never dead-ends.
    const nativeCamera = typeof window !== 'undefined' ? window.NativeApp?.camera : undefined;
    if (nativeCamera?.scan) {
      void nativeCamera
        .scan()
        .then((shot) => {
          if (!shot) {
            inputRef.current?.click();
            return;
          }
          onFiles([base64ToFile(shot)]);
        })
        .catch(() => inputRef.current?.click());
      return;
    }
    inputRef.current?.click();
  }, [disabled, onFiles]);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  const onDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
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
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
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
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openPicker();
      }
    },
    [disabled, openPicker],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Add files to print"
      aria-disabled={disabled || undefined}
      aria-describedby={`${inputId}-formats`}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'min-h-[200px] w-full',
        'flex flex-col items-center justify-center text-center gap-3',
        'rounded-[var(--radius-group)]',
        'border-2 border-dashed px-6 py-8',
        'transition-colors duration-150',
        disabled ? 'opacity-50 pointer-events-none cursor-not-allowed' : 'cursor-pointer',
        isDragging
          ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
          : 'border-[var(--hairline)] bg-[var(--surface)]',
        className,
      ].join(' ')}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        disabled={disabled}
      />

      {/* Accent-tint circle holding the upload glyph — the only loud element. */}
      <span
        className="flex size-14 items-center justify-center rounded-full bg-[var(--accent-tint)] text-[var(--accent-tint-text)]"
        aria-hidden="true"
      >
        <UploadCloud className="size-7" strokeWidth={2} />
      </span>

      <p className="text-base font-semibold text-[var(--label)]">
        Add files to print
      </p>
      <p
        id={`${inputId}-formats`}
        className="text-[13px] text-[var(--label-2)] leading-relaxed max-w-[280px]"
      >
        {acceptedFormatsLabel}
      </p>
    </div>
  );
}

export { UploadDropzone as ClearUploadDropzone };
export default UploadDropzone;
