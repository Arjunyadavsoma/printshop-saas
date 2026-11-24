'use client';

/**
 * ReferenceColorPages — Screen 13 (B Clear) + Screen 08 (Desktop Builder)
 *
 * Implements the per-page colour selection screen in two layouts:
 *   - Mobile (.ref-screen m): the "B Clear" screen with auto colour detection
 *   - Desktop (.ref-screen d): the "Desktop Builder" with sidebar settings
 *
 * The component auto-detects viewport and renders the appropriate layout.
 * Both layouts share the same page-grid and pricing logic.
 *
 * Features:
 *   - Auto colour detection (pages with images → colour, text-only → B&W)
 *   - Per-page toggle (tap any page to switch between B&W and colour)
 *   - Segmented control: All B&W / Mixed / All colour
 *   - Live price calculation (B&W pages × bwPrice + colour pages × colorPrice)
 *   - "Review order" button → navigates back to the review step
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface ColorPageFile {
  fileId: string;
  fileName: string;
  pageCount: number;
  /** Initial auto-detected colour pages (1-indexed) */
  initialColorPages: number[];
}

export interface ColorPagesProps {
  shopName: string;
  shopSlug: string;
  files: ColorPageFile[];
  bwPrice: number;   // paise per B&W page
  colorPrice: number; // paise per colour page
  copies: number;
  sides: 'SINGLE' | 'DOUBLE';
  paperSize: string;
  duplex: boolean;
  onReview: (colorPages: Record<string, number[]>) => void;
  onBack: () => void;
}

type SegMode = 'all-bw' | 'mixed' | 'all-color';

export function ReferenceColorPages(props: ColorPagesProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  // Per-file colour page sets (1-indexed page numbers)
  const [colorPages, setColorPages] = useState<Record<string, number[]>>(() => {
    const init: Record<string, number[]> = {};
    for (const f of props.files) {
      init[f.fileId] = [...f.initialColorPages];
    }
    return init;
  });
  const [segMode, setSegMode] = useState<SegMode>('mixed');

  // Detect viewport
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const activeFile = props.files[activeFileIdx] ?? props.files[0];

  // Apply segmented mode to the active file
  const applySegMode = useCallback((mode: SegMode) => {
    setSegMode(mode);
    if (!activeFile) return;
    setColorPages(prev => {
      const next = { ...prev };
      if (mode === 'all-bw') {
        next[activeFile.fileId] = [];
      } else if (mode === 'all-color') {
        next[activeFile.fileId] = Array.from({ length: activeFile.pageCount }, (_, i) => i + 1);
      } else {
        // mixed = restore auto-detected
        next[activeFile.fileId] = [...activeFile.initialColorPages];
      }
      return next;
    });
  }, [activeFile]);

  // Toggle a single page's colour state
  const togglePage = useCallback((pageIdx: number) => {
    if (!activeFile) return;
    setColorPages(prev => {
      const current = new Set(prev[activeFile.fileId] ?? []);
      if (current.has(pageIdx)) {
        current.delete(pageIdx);
      } else {
        current.add(pageIdx);
      }
      const sorted = Array.from(current).sort((a, b) => a - b);
      return { ...prev, [activeFile.fileId]: sorted };
    });
    setSegMode('mixed'); // custom selection = mixed
  }, [activeFile]);

  // Calculate totals across ALL files
  const totals = useMemo(() => {
    let bwPages = 0;
    let colorPagesCount = 0;
    for (const f of props.files) {
      const cp = new Set(colorPages[f.fileId] ?? []);
      colorPagesCount += cp.size;
      bwPages += f.pageCount - cp.size;
    }
    const bwTotalPaise = bwPages * props.bwPrice * props.copies;
    const colorTotalPaise = colorPagesCount * props.colorPrice * props.copies;
    return {
      bwPages,
      colorPagesCount,
      totalPaise: bwTotalPaise + colorTotalPaise,
      totalRupees: Math.ceil((bwTotalPaise + colorTotalPaise) / 100),
    };
  }, [colorPages, props.files, props.bwPrice, props.colorPrice, props.copies]);

  const formatRupees = (paise: number) => `₹${Math.ceil(paise / 100)}`;

  if (!activeFile) {
    return (
      <div className="ref-screen m">
        <div className="ref-top">{props.shopName}</div>
        <h1 className="ref-h">Choose colour pages</h1>
        <p className="ref-sub">No files to configure</p>
        <div className="ref-bar">
          <button className="ref-btn" onClick={props.onBack}>Back</button>
        </div>
      </div>
    );
  }

  const activeColorSet = new Set(colorPages[activeFile.fileId] ?? []);

  // Shared page grid component
  const renderPageGrid = (columns: number) => (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: columns > 4 ? '10px' : '8px', marginTop: '6px' }}>
      {Array.from({ length: activeFile.pageCount }, (_, i) => {
        const pageNum = i + 1;
        const isColor = activeColorSet.has(pageNum);
        return (
          <button
            key={pageNum}
            className={`ref-pg ${isColor ? 'c' : 'b'}`}
            aria-label={`Page ${pageNum}, ${isColor ? 'colour' : 'black and white'}`}
            onClick={() => togglePage(pageNum)}
          >
            <span>{pageNum}</span>
            <i></i>
            <em>{isColor ? 'Colour' : 'B&W'}</em>
          </button>
        );
      })}
    </div>
  );

  // Shared segmented control
  const renderSegmented = () => (
    <div className="ref-seg" style={isDesktop ? { margin: '16px 0 0', maxWidth: '420px' } : undefined}>
      <button className={segMode === 'all-bw' ? 'on' : ''} onClick={() => applySegMode('all-bw')}>All B&W</button>
      <button className={segMode === 'mixed' ? 'on' : ''} onClick={() => applySegMode('mixed')}>Mixed</button>
      <button className={segMode === 'all-color' ? 'on' : ''} onClick={() => applySegMode('all-color')}>All colour</button>
    </div>
  );

  // Shared bottom bar
  const renderBottomBar = () => (
    <div className="ref-bar">
      <div style={{ flex: 1 }}>
        <small>{totals.bwPages} B&W, {totals.colorPagesCount} colour</small>
        <b>{formatRupees(totals.totalPaise)}</b>
      </div>
      <button className="ref-btn" onClick={() => props.onReview(colorPages)}>Review order</button>
    </div>
  );

  if (isDesktop) {
    // Screen 08 — Desktop Builder
    return (
      <div className="ref-screen d">
        {/* Top bar */}
        <div style={{
          height: '64px',
          background: '#fff',
          borderBottom: '1px solid #DADBE1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 40px',
        }}>
          <b style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="ref-dot"></i>
            {props.shopName}, open
          </b>
          <span className="ref-v">Help</span>
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', gap: '24px', padding: '28px 40px', flex: 1 }}>
          {/* Left: page grid */}
          <div style={{ flex: 1 }}>
            <h1 className="ref-h" style={{ margin: 0, fontSize: '44px' }}>Choose colour pages</h1>
            {renderSegmented()}
            <div className="ref-g p" style={{ margin: '16px 0 0' }}>
              <div className="ref-r" style={{ minHeight: '40px' }}>
                <b>{activeFile.fileName}</b>
                <span className="ref-v">{activeFile.pageCount} pages</span>
              </div>
              {renderPageGrid(6)}
            </div>
            <p className="ref-cap" style={{ margin: '12px 0 0' }}>
              {totals.colorPagesCount === 0 ? 'All pages are set to black & white. Click any page to make it colour.' : `${totals.colorPagesCount} ${totals.colorPagesCount === 1 ? 'page looks' : 'pages look'} colourful, so those pages are set to colour. Click any page to switch it.`}
            </p>

            {/* File selector tabs */}
            {props.files.length > 1 && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                {props.files.map((f, idx) => (
                  <button
                    key={f.fileId}
                    className={`ref-chip ${idx === activeFileIdx ? '' : 'ok'}`}
                    onClick={() => setActiveFileIdx(idx)}
                    style={{ cursor: 'pointer', opacity: idx === activeFileIdx ? 1 : 0.6 }}
                  >
                    {f.fileName}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: settings sidebar */}
          <div style={{ width: '360px' }}>
            <div className="ref-g" style={{ margin: 0 }}>
              <div className="ref-r"><span>Print style</span><span className="ref-v">Mix</span></div>
              <div className="ref-r"><span>Copies</span><span className="ref-v">{props.copies}</span></div>
              <div className="ref-r"><span>Paper</span><span className="ref-v">{props.paperSize}</span></div>
              <div className="ref-r">
                <span>Double-sided</span>
                <i className={`ref-sw ${props.duplex ? '' : 'off'}`}></i>
              </div>
            </div>
            <div className="ref-g p" style={{ marginTop: '16px' }}>
              <div className="ref-r" style={{ minHeight: '40px' }}>
                <span>{totals.bwPages} B&W pages</span>
                <b>{formatRupees(totals.bwPages * props.bwPrice * props.copies)}</b>
              </div>
              <div className="ref-r" style={{ minHeight: '40px' }}>
                <span>{totals.colorPagesCount} colour pages</span>
                <b>{formatRupees(totals.colorPagesCount * props.colorPrice * props.copies)}</b>
              </div>
              <div className="ref-r" style={{ minHeight: '48px' }}>
                <b>Total</b>
                <b style={{ fontSize: '24px' }}>{formatRupees(totals.totalPaise)}</b>
              </div>
              <button className="ref-btn" style={{ width: '100%', marginTop: '12px' }} onClick={() => props.onReview(colorPages)}>
                Review order
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Screen 13 — B Clear (mobile)
  return (
    <div className="ref-screen m">
      <div className="ref-top">
        <i className="ref-dot"></i>
        {props.shopName}, open
      </div>
      <div style={{ padding: '8px 20px 0' }}>
        <h1 className="ref-h" style={{ margin: 0 }}>Choose colour pages</h1>
        <div style={{ fontSize: '16px', color: '#5B5F66', marginTop: '6px' }}>Step 2 of 3</div>
      </div>
      {renderSegmented()}
      <div className="ref-g p" style={{ marginTop: '16px' }}>
        <div className="ref-r" style={{ minHeight: '40px' }}>
          <b>{activeFile.fileName}</b>
          <span className="ref-v">{activeFile.pageCount} pages</span>
        </div>
        {renderPageGrid(4)}
      </div>
      <p className="ref-cap">
        {totals.colorPagesCount === 0 ? 'All pages are set to black & white. Tap any page to make it colour.' : `${totals.colorPagesCount} ${totals.colorPagesCount === 1 ? 'page looks' : 'pages look'} colourful, so those pages are set to colour. Tap any page to switch it.`}
      </p>

      {/* File selector for multiple files */}
      {props.files.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', margin: '12px 20px 0', overflowX: 'auto' }}>
          {props.files.map((f, idx) => (
            <button
              key={f.fileId}
              className={`ref-chip ${idx === activeFileIdx ? '' : 'ok'}`}
              onClick={() => setActiveFileIdx(idx)}
              style={{ cursor: 'pointer', opacity: idx === activeFileIdx ? 1 : 0.6, whiteSpace: 'nowrap' }}
            >
              {f.fileName}
            </button>
          ))}
        </div>
      )}

      {renderBottomBar()}
    </div>
  );
}
