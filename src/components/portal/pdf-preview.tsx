'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  ChevronLeft, ChevronRight, Check, FileText, Loader2, AlertCircle, Image as ImageIcon,
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

/**
 * Professional PDF/Document preview component.
 *
 * Features:
 * - Renders PDF page thumbnails using PDF.js (client-side, no server rendering)
 * - 5 pages per view with pagination (1, 2, 3, 4, 5 → next/prev)
 * - Each page has a checkbox (all selected by default)
 * - User can deselect pages → those won't be printed
 * - For images: shows a single thumbnail
 * - For non-previewable files: shows a professional placeholder
 * - "Select All" / "Deselect All" controls
 * - Selected page count badge
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
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const workerRef = useRef<Worker | null>(null);

  // Load the PDF and render thumbnails
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setThumbnails([]);

      try {
        // Get the PDF data
        let pdfData: ArrayBuffer | null = null;

        if (file) {
          pdfData = await file.arrayBuffer();
        } else if (fileUrl) {
          const res = await fetch(fileUrl);
          pdfData = await res.arrayBuffer();
        }

        if (!pdfData) {
          setError('No file to preview');
          setLoading(false);
          return;
        }

        // Dynamically import PDF.js
        const pdfjs = await import('pdfjs-dist');

        // Set up the worker
        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
            { type: 'module' }
          );
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
        onSelectionChange?.(Array.from(allPages).sort((a, b) => a - b));

        // Render each page to a canvas → data URL thumbnail
        const thumbs: string[] = [];
        for (let i = 1; i <= numPages; i++) {
          if (cancelled) return;

          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.5 }); // 50% scale for thumbnails

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

          thumbs.push(canvas.toDataURL('image/jpeg', 0.7));
          setThumbnails([...thumbs]);

          if (i === numPages) {
            setLoading(false);
            onReady?.();
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Failed to load PDF preview');
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
  }, [file, fileUrl, mimeType, onSelectionChange, onReady]);

  // Toggle page selection
  const togglePage = useCallback((pageNum: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) {
        next.delete(pageNum);
      } else {
        next.add(pageNum);
      }
      onSelectionChange?.(Array.from(next).sort((a, b) => a - b));
      return next;
    });
  }, [onSelectionChange]);

  // Select / deselect all
  const selectAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 1; i <= renderedPageCount; i++) all.add(i);
    setSelectedPages(all);
    onSelectionChange?.(Array.from(all).sort((a, b) => a - b));
  }, [renderedPageCount, onSelectionChange]);

  const deselectAll = useCallback(() => {
    setSelectedPages(new Set());
    onSelectionChange?.([]);
  }, [onSelectionChange]);

  // Pagination
  const totalPages = thumbnails.length;
  const pageGroups = Math.ceil(totalPages / PAGES_PER_VIEW);
  const currentGroupStart = currentPage * PAGES_PER_VIEW;
  const currentGroupThumbs = thumbnails.slice(currentGroupStart, currentGroupStart + PAGES_PER_VIEW);
  const currentGroupPageNumbers = Array.from(
    { length: currentGroupThumbs.length },
    (_, i) => currentGroupStart + i + 1
  );

  // For images: show a single preview
  if (mimeType.startsWith('image/') && !mimeType.includes('pdf')) {
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        <div className="relative">
          {file ? (
            <img
              src={URL.createObjectURL(file)}
              alt="Preview"
              className="max-h-64 rounded-lg border shadow-sm"
            />
          ) : fileUrl ? (
            <img src={fileUrl} alt="Preview" className="max-h-64 rounded-lg border shadow-sm" />
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
      <div className="flex flex-col items-center gap-3 p-8">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Rendering PDF pages...</p>
      </div>
    );
  }

  // PDF error state
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-6">
        <AlertCircle className="size-8 text-amber-500" />
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
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {selectedPages.size} / {totalPages} pages selected
          </Badge>
          <span className="text-xs text-muted-foreground">
            ({((selectedPages.size / totalPages) * 100 || 0).toFixed(0)}% of document)
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={selectAll}
          >
            Select All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={deselectAll}
          >
            Deselect All
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
              className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
                isSelected
                  ? 'border-green-500 shadow-md'
                  : 'border-border opacity-50 hover:opacity-100'
              }`}
              onClick={() => togglePage(pageNum)}
            >
              {/* Thumbnail */}
              <div className="aspect-[3/4] w-full bg-muted">
                <img
                  src={thumb}
                  alt={`Page ${pageNum}`}
                  className="h-full w-full object-contain"
                />
              </div>

              {/* Selection checkbox */}
              <div
                className={`absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border-2 shadow-sm transition-all ${
                  isSelected
                    ? 'border-green-500 bg-green-600 text-white'
                    : 'border-white bg-white/80 text-transparent group-hover:border-green-400'
                }`}
              >
                <Check className="size-3" />
              </div>

              {/* Page number */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5">
                <span className="text-[10px] font-medium text-white">Page {pageNum}</span>
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
          >
            <ChevronLeft className="size-4" />
          </Button>

          <div className="flex gap-1">
            {Array.from({ length: pageGroups }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
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
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Selected pages summary */}
      <div className="text-center text-xs text-muted-foreground">
        {selectedPages.size > 0 ? (
          <span>
            Printing {selectedPages.size} of {totalPages} pages
            {selectedPages.size < totalPages && (
              <span className="ml-1 text-amber-700">
                ({totalPages - selectedPages.size} page{totalPages - selectedPages.size > 1 ? 's' : ''} excluded)
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
