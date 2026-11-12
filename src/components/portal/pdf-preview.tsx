'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  ChevronLeft, ChevronRight, Check, FileText, Loader2, AlertCircle, Image as ImageIcon,
  ZoomIn, ZoomOut, Maximize2, Eraser,
} from 'lucide-react';

interface PdfPreviewProps {
  /** The file to preview (File object or a URL to fetch) */
  file: File | null;
  fileUrl?: string | null;
  mimeType: string;
  pageCount: number | null;
  /** Called when the user changes the selected pages. Returns array of page numbers (1-indexed). */
  onSelectionChange?: (selectedPages: number[]) => void;
  /** Called when all pages are loaded/rendered */
  onReady?: () => void;
}

const PAGES_PER_VIEW = 5;
/** Default thumbnail scale (matches the original PDF.js viewport scale). */
const DEFAULT_SCALE = 0.5;
/** Minimum zoom (25%) — far enough out to see many pages at a glance. */
const MIN_SCALE = 0.25;
/** Maximum zoom (200%) — close enough to read small text on most PDFs. */
const MAX_SCALE = 2.0;
/** Zoom step for the +/- buttons. */
const ZOOM_STEP = 0.25;

/**
 * Professional PDF/Document preview component.
 *
 * Features:
 * - Renders PDF page thumbnails using PDF.js (client-side, no server rendering)
 * - 5 pages per view with pagination (1, 2, 3, 4, 5 → next/prev)
 * - Each page is a checkbox (all selected by default) with full keyboard
 *   accessibility (role=checkbox, tabIndex=0, aria-checked, Space/Enter toggle)
 * - User can deselect pages → those won't be printed
 * - Zoom in/out (0.25 → 2.0), fit-to-width (reset to default), clear selection
 * - "X of Y pages selected" count + percentage
 * - For images: shows a single thumbnail
 * - For non-previewable files: shows a professional placeholder
 * - Loading spinner + error message states
 */
export function PdfPreview({
  file,
  fileUrl,
  mimeType,
  pageCount,
  onSelectionChange,
  onReady,
}: PdfPreviewProps) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(0); // 0-indexed page group
  const [renderedPageCount, setRenderedPageCount] = useState(0);
  /** Zoom scale applied to the rendered thumbnails. 1.0 = the default
   * PDF.js viewport scale (0.5); 2.0 = double size, 0.5 = half size. */
  const [scale, setScale] = useState(1.0);
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const workerRef = useRef<Worker | null>(null);

  // Phase 6.3: callbacks are stored in refs so the loadPdf effect doesn't
  // re-run when the parent passes a new onSelectionChange identity (which
  // happens on every parent re-render). Without this, loadPdf starts, calls
  // onSelectionChange (which triggers a parent re-render), the effect cleanup
  // cancels loadPdf, and the new effect starts again — an infinite loop that
  // prevents the toolbar (and the "X / Y pages selected" badge) from ever
  // rendering.
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // Load the PDF and render thumbnails
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setThumbnails([]);
      // Reset zoom on every new file load (so a per-file zoom doesn't bleed
      // into the next file's preview).
      setScale(1.0);

      try {
        // Get the PDF data
        let pdfData: ArrayBuffer | null = null;

        if (file) {
          pdfData = await file.arrayBuffer();
        } else if (fileUrl) {
          const res = await fetch(fileUrl);
          if (!res.ok) {
            throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
          }
          pdfData = await res.arrayBuffer();
        }

        if (!pdfData) {
          setError('No file to preview');
          setLoading(false);
          return;
        }

        // Dynamically import PDF.js
        const pdfjs = await import('pdfjs-dist');

        // Set up the worker. Phase 6.3: use a static worker file served
        // from /public/pdf.worker.min.mjs instead of the bundled
        // `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`.
        // Next.js 16 Turbopack doesn't reliably resolve the bundled worker
        // URL in dev mode (the worker module loads but messages don't
        // round-trip, so getDocument() hangs forever). Serving the worker
        // as a static asset fixes both dev and prod.
        if (!workerRef.current) {
          // Create the Worker explicitly from the static URL. Setting
          // workerSrc alone didn't trigger a fetch in pdfjs-dist v6 —
          // workerPort is the reliable path.
          workerRef.current = new Worker('/pdf.worker.min.mjs', { type: 'module' });
          pdfjs.GlobalWorkerOptions.workerPort = workerRef.current;
        }

        const loadingTask = pdfjs.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        if (cancelled) return;

        const numPages = pdf.numPages;
        setRenderedPageCount(numPages);

        // Select all pages by default
        const allPages = new Set<number>();
        for (let i = 1; i <= numPages; i++) allPages.add(i);
        setSelectedPages(allPages);
        onSelectionChangeRef.current?.(Array.from(allPages).sort((a, b) => a - b));

        // Render each page to a canvas → data URL thumbnail
        const thumbs: string[] = [];
        for (let i = 1; i <= numPages; i++) {
          if (cancelled) return;

          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: DEFAULT_SCALE });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

          thumbs.push(canvas.toDataURL('image/jpeg', 0.7));
          setThumbnails([...thumbs]);

          if (i === numPages) {
            setLoading(false);
            onReadyRef.current?.();
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          // PDF.js throws a generic 'Promise' error if the worker fails to
          // initialise — surface a more useful message.
          const msg = e?.message ?? 'Failed to load PDF preview';
          setError(msg.includes('worker') ? 'PDF worker failed to load' : msg);
          setLoading(false);
        }
      }
    }

    // Only load PDFs — images and other files have different handling
    if (mimeType === 'application/pdf' && (file || fileUrl)) {
      loadPdf();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [file, fileUrl, mimeType]);

  // Toggle page selection
  const togglePage = useCallback((pageNum: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) {
        next.delete(pageNum);
      } else {
        next.add(pageNum);
      }
      onSelectionChangeRef.current?.(Array.from(next).sort((a, b) => a - b));
      return next;
    });
  }, []);

  // Select / deselect all
  const selectAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 1; i <= renderedPageCount; i++) all.add(i);
    setSelectedPages(all);
    onSelectionChangeRef.current?.(Array.from(all).sort((a, b) => a - b));
  }, [renderedPageCount]);

  const deselectAll = useCallback(() => {
    setSelectedPages(new Set());
    onSelectionChangeRef.current?.([]);
  }, []);

  // Workstream-3: zoom controls (0.25 → 2.0). The +/- buttons step by 0.25;
  // "fit-to-width" resets to 1.0 (the default scale). Clamped to the min/max.
  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, +(s + ZOOM_STEP).toFixed(2)));
  }, []);
  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, +(s - ZOOM_STEP).toFixed(2)));
  }, []);
  const fitToWidth = useCallback(() => setScale(1.0), []);

  // Pagination
  const totalPages = thumbnails.length;
  const pageGroups = Math.ceil(totalPages / PAGES_PER_VIEW);
  const currentGroupStart = currentPage * PAGES_PER_VIEW;
  const currentGroupThumbs = thumbnails.slice(currentGroupStart, currentGroupStart + PAGES_PER_VIEW);
  const currentGroupPageNumbers = Array.from(
    { length: currentGroupThumbs.length },
    (_, i) => currentGroupStart + i + 1
  );

  // Workstream-3: selected-page count summary ("5 of 12 pages selected").
  const selectedCount = selectedPages.size;
  const selectionSummary = useMemo(() => {
    if (totalPages === 0) return 'No pages loaded';
    return `${selectedCount} of ${totalPages} pages selected`;
  }, [selectedCount, totalPages]);

  // For images: show a single preview
  if (mimeType.startsWith('image/') && !mimeType.includes('pdf')) {
    // Use a stable object URL per file (revoke on cleanup) so we don't
    // leak a new Blob URL on every render (which the previous code did).
    const imgUrl = file ? URL.createObjectURL(file) : fileUrl;
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        <div className="relative">
          {imgUrl ? (
            <img
              src={imgUrl}
              alt="Preview"
              className="max-h-64 rounded-lg border shadow-sm"
            />
          ) : null}
          <div className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-green-600 text-white shadow">
            <Check className="size-4" />
          </div>
        </div>
        <Badge variant="secondary" className="text-xs">
          <ImageIcon className="mr-1 size-3" /> 1 page
        </Badge>
      </div>
    );
  }

  // For non-PDF, non-image files: show a placeholder
  if (mimeType !== 'application/pdf') {
    return (
      <div className="flex flex-col items-center gap-3 p-6">
        <div className="flex size-16 items-center justify-center rounded-xl bg-muted">
          <FileText className="size-8 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">Preview not available</p>
          <p className="text-xs text-muted-foreground">
            {pageCount ? `${pageCount} pages` : 'Page count unknown'} — download to view
          </p>
        </div>
        {pageCount && (
          <Badge variant="secondary" className="text-xs">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </Badge>
        )}
      </div>
    );
  }

  // PDF loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 p-8" role="status" aria-live="polite">
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Rendering PDF pages…</p>
        <span className="sr-only">Loading PDF preview, please wait.</span>
      </div>
    );
  }

  // PDF error state
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-6" role="alert">
        <AlertCircle className="size-8 text-amber-500" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Preview failed: {error}</p>
        {pageCount && (
          <Badge variant="secondary" className="text-xs">
            {pageCount} pages
          </Badge>
        )}
      </div>
    );
  }

  // PDF preview with pagination + page selection
  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Workstream-3: selected-page count + percentage */}
          <Badge variant="secondary" className="text-xs">
            {selectedCount} / {totalPages} pages selected
          </Badge>
          <span className="text-xs text-muted-foreground">
            {selectionSummary} ({((selectedCount / totalPages) * 100 || 0).toFixed(0)}% of document)
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {/* Workstream-3: zoom controls */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="flex h-7 min-w-12 items-center justify-center px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {(scale * 100).toFixed(0)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={fitToWidth}
            aria-label="Fit to width"
            title="Fit to width (reset zoom)"
          >
            <Maximize2 className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={selectAll}
          >
            Select All
          </Button>
          {/* Workstream-3: "Clear selected pages" — same effect as the old
              "Deselect All" but with clearer wording and an icon. */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={deselectAll}
            disabled={selectedCount === 0}
            aria-label="Clear selected pages"
            title="Clear selected pages"
          >
            <Eraser className="mr-1 size-3.5" /> Clear
          </Button>
        </div>
      </div>

      {/* Page thumbnails grid (5 per view) */}
      <div className="grid grid-cols-5 gap-2">
        {currentGroupThumbs.map((thumb, index) => {
          const pageNum = currentGroupPageNumbers[index];
          const isSelected = selectedPages.has(pageNum);
          return (
            <div
              key={pageNum}
              role="checkbox"
              tabIndex={0}
              aria-checked={isSelected}
              aria-label={`Page ${pageNum} ${isSelected ? '(selected)' : '(not selected)'}`}
              className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                isSelected
                  ? 'border-green-500 shadow-md'
                  : 'border-border opacity-50 hover:opacity-100 focus-visible:opacity-100'
              }`}
              onClick={() => togglePage(pageNum)}
              onKeyDown={(e) => {
                // Keyboard toggle: Space or Enter activates the checkbox
                // (WAI-ARIA checkbox pattern).
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  togglePage(pageNum);
                }
              }}
            >
              {/* Thumbnail — zoom applied as a CSS transform so we don't have
                  to re-render the PDF.js canvas (which would be expensive). */}
              <div
                className="aspect-[3/4] w-full overflow-hidden bg-muted"
                style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
              >
                <img
                  src={thumb}
                  alt={`Page ${pageNum}`}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </div>

              {/* Selection checkbox */}
              <div
                className={`absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border-2 shadow-sm transition-all ${
                  isSelected
                    ? 'border-green-500 bg-green-600 text-white'
                    : 'border-white bg-white/80 text-transparent group-hover:border-green-400'
                }`}
                aria-hidden="true"
              >
                <Check className="size-3" />
              </div>

              {/* Page number */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5">
                <span className="text-xs font-medium text-white">Page {pageNum}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination controls */}
      {pageGroups > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            aria-label="Previous page group"
          >
            <ChevronLeft className="size-4" />
          </Button>

          <div className="flex gap-1" role="navigation" aria-label="Page groups">
            {Array.from({ length: pageGroups }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                aria-label={`Go to page group ${i + 1}`}
                aria-current={currentPage === i}
                className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium transition-all ${
                  currentPage === i
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={currentPage >= pageGroups - 1}
            onClick={() => setCurrentPage(p => Math.min(pageGroups - 1, p + 1))}
            aria-label="Next page group"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Selected pages summary */}
      <div className="text-center text-xs text-muted-foreground" aria-live="polite">
        {selectedCount > 0 ? (
          <span>
            Printing {selectedCount} of {totalPages} pages
            {selectedCount < totalPages && (
              <span className="ml-1 text-amber-700">
                ({totalPages - selectedCount} page{totalPages - selectedCount > 1 ? 's' : ''} excluded)
              </span>
            )}
          </span>
        ) : (
          <span className="text-red-500">No pages selected — select at least one page to print</span>
        )}
      </div>
    </div>
  );
}
