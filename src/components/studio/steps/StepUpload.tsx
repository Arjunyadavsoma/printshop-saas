'use client';

import { useRef, useState } from 'react';
import { UploadCloud, FileText, X, RefreshCw, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import type { StudioFile, ShopCapabilities } from '../types';
import { formatSize } from '../types';
import { MAX_FILE_BYTES } from '../studio-api';

/**
 * Step 1 — Upload Documents.
 *
 * Drag-and-drop on desktop, native file picker on mobile. Each file appears
 * in a professional document card with name, type, size, page count, upload
 * progress, status, retry and remove actions.
 *
 * Reuses the existing chunked-upload system (init → chunk → complete → poll)
 * via the orchestrator's `onAddFiles` callback. Never simulates uploads.
 */
export function StepUpload({
  files, shop, onAddFiles, onRemove, onRetry, onNext, canNext,
}: {
  files: StudioFile[];
  shop: ShopCapabilities;
  onAddFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onNext: () => void;
  canNext: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) onAddFiles(e.dataTransfer.files);
  };

  const readyCount = files.filter((f) => f.status === 'ready').length;
  const processingCount = files.filter((f) => f.status === 'uploading' || f.status === 'converting').length;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--label)]">Upload your documents</h1>
        <p className="mt-1 text-[14px] text-[var(--label-2)]">
          PDF, images (JPG/PNG), Word, PowerPoint, Excel. Up to {formatSize(MAX_FILE_BYTES)} per file.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-[14px] border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragOver
            ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
            : 'border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--accent)]/40 hover:bg-[var(--ground)]',
        ].join(' ')}
        aria-label="Upload documents — click or drag files here"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff"
          className="sr-only"
          onChange={(e) => { if (e.target.files) onAddFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="flex size-12 items-center justify-center rounded-full bg-[var(--accent-tint)]">
          <UploadCloud className="size-6 text-[var(--accent)]" aria-hidden="true" />
        </div>
        <p className="mt-3 text-[15px] font-semibold text-[var(--label)]">
          {dragOver ? 'Drop your files here' : 'Click to browse or drag files'}
        </p>
        <p className="mt-1 text-[13px] text-[var(--label-2)]">
          PDF · Images · Word · PowerPoint · Excel
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-3">
          {files.map((file) => (
            <FileCard key={file.id} file={file} onRemove={() => onRemove(file.id)} onRetry={() => onRetry(file.id)} />
          ))}
        </div>
      )}

      {/* Empty hint */}
      {files.length === 0 && (
        <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-8 text-center">
          <FileText className="mx-auto size-10 text-[var(--label-3)]" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-[15px] font-semibold text-[var(--label)]">No documents yet</p>
          <p className="mt-1 text-[14px] text-[var(--label-2)]">
            Upload a PDF or image to start configuring your print order.
          </p>
        </div>
      )}

      {/* Add more + Next */}
      {files.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
          >
            <UploadCloud className="size-4" aria-hidden="true" /> Add more files
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext || processingCount > 0}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)] disabled:opacity-50"
          >
            {processingCount > 0 ? `Processing ${processingCount}…` : `Continue (${readyCount} ready)`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Document card ─────────────────────────────────────────────────────── */
function FileCard({ file, onRemove, onRetry }: { file: StudioFile; onRemove: () => void; onRetry: () => void }) {
  const statusBadge = () => {
    switch (file.status) {
      case 'uploading':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-tint)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-tint-text)]"><Loader2 className="size-3 animate-spin" /> Uploading {file.progress}%</span>;
      case 'converting':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-tint)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-tint-text)]"><Loader2 className="size-3 animate-spin" /> Processing</span>;
      case 'ready':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0FDF4] px-2.5 py-1 text-[11px] font-semibold text-[#16A34A]"><CheckCircle2 className="size-3" /> Ready</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#DC2626]"><AlertCircle className="size-3" /> Failed</span>;
      default:
        return null;
    }
  };

  return (
    <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex items-start gap-3">
        {/* File type icon */}
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--ground)]">
          <FileText className="size-5 text-[var(--accent)]" aria-hidden="true" />
        </div>

        {/* File info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-[var(--label)]">{file.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--label-2)]">
            <span>{formatSize(file.sizeBytes)}</span>
            {file.pageCount != null && <span>{file.pageCount} pages</span>}
            <span className="uppercase">{file.mimeType.split('/')[1] ?? 'file'}</span>
          </div>
          {file.failReason && (
            <p className="mt-1.5 text-[12px] text-[#DC2626]">{file.failReason}</p>
          )}
        </div>

        {/* Status + actions */}
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge()}
          {file.status === 'failed' && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-[8px] border border-[var(--hairline)] px-2.5 text-[12px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
              aria-label="Re-upload this file"
            >
              <RefreshCw className="size-3.5" /> Re-add
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--label-3)] hover:bg-[var(--ground)] hover:text-[#DC2626]"
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {file.status === 'uploading' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--ground)]">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-200" style={{ width: `${file.progress}%` }} />
        </div>
      )}
    </div>
  );
}
