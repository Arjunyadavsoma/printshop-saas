'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Multi-range page selector.
 *
 * Allows users to select multiple non-contiguous page ranges.
 * Example: pages 5-20, then add another range 56-99.
 *
 * Outputs a comma-separated page range string compatible with the
 * existing parsePageRange function (e.g. "5-20,56-99").
 */

interface RangeEntry {
  id: string;
  from: string;
  to: string;
}

interface PageRangeSelectorProps {
  pageCount: number | null;
  value: string | null;
  onChange: (range: string | null) => void;
  className?: string;
}

export function PageRangeSelector({
  pageCount, value, onChange, className,
}: PageRangeSelectorProps) {
  const [ranges, setRanges] = useState<RangeEntry[]>([]);
  const [allPages, setAllPages] = useState(true);

  // Parse existing value into ranges on mount
  useEffect(() => {
    if (!value || value.trim() === '') {
      setAllPages(true);
      setRanges([]);
      return;
    }
    setAllPages(false);
    const parts = value.split(',').map(p => p.trim());
    const entries: RangeEntry[] = [];
    for (const part of parts) {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
      if (rangeMatch) {
        entries.push({
          id: crypto.randomUUID(),
          from: rangeMatch[1],
          to: rangeMatch[2],
        });
      } else if (/^\d+$/.test(part)) {
        entries.push({
          id: crypto.randomUUID(),
          from: part,
          to: part,
        });
      }
    }
    setRanges(entries.length > 0 ? entries : []);
  }, [value]);

  const buildRangeString = useCallback((entries: RangeEntry[]): string | null => {
    const valid = entries.filter(e => e.from && e.to);
    if (valid.length === 0) return null;
    return valid.map(e => e.from === e.to ? e.from : `${e.from}-${e.to}`).join(',');
  }, []);

  const updateEntry = useCallback((id: string, field: 'from' | 'to', val: string) => {
    // Only allow digits
    const cleaned = val.replace(/[^\d]/g, '');
    const newRanges = ranges.map(r => r.id === id ? { ...r, [field]: cleaned } : r);
    setRanges(newRanges);
    const rangeStr = buildRangeString(newRanges);
    onChange(allPages ? null : rangeStr);
  }, [ranges, allPages, buildRangeString, onChange]);

  const addRange = useCallback(() => {
    setAllPages(false);
    const newEntry: RangeEntry = { id: crypto.randomUUID(), from: '', to: '' };
    const newRanges = [...ranges, newEntry];
    setRanges(newRanges);
  }, [ranges]);

  const removeRange = useCallback((id: string) => {
    const newRanges = ranges.filter(r => r.id !== id);
    setRanges(newRanges);
    if (newRanges.length === 0) {
      setAllPages(true);
      onChange(null);
    } else {
      const rangeStr = buildRangeString(newRanges);
      onChange(rangeStr);
    }
  }, [ranges, buildRangeString, onChange]);

  const selectAll = useCallback(() => {
    setAllPages(true);
    setRanges([]);
    onChange(null);
  }, [onChange]);

  const max = pageCount ?? 0;

  return (
    <div className={cn('space-y-2', className)}>
      {/* All pages option */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          checked={allPages}
          onChange={selectAll}
          className="size-4 accent-brand"
          aria-label="Print all pages"
        />
        <span className="text-foreground">All pages{max > 0 && ` (${max})`}</span>
      </label>

      {/* Custom ranges */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          checked={!allPages}
          onChange={() => { setAllPages(false); if (ranges.length === 0) addRange(); }}
          className="size-4 accent-brand"
          aria-label="Select specific pages"
        />
        <span className="text-foreground">Custom pages</span>
      </label>

      {!allPages && (
        <div className="ml-6 space-y-2">
          {ranges.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="From"
                value={entry.from}
                onChange={(e) => updateEntry(entry.id, 'from', e.target.value)}
                className="w-20 text-sm"
                aria-label={`Range start page ${ranges.indexOf(entry) + 1}`}
                maxLength={4}
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="To"
                value={entry.to}
                onChange={(e) => updateEntry(entry.id, 'to', e.target.value)}
                className="w-20 text-sm"
                aria-label={`Range end page ${ranges.indexOf(entry) + 1}`}
                maxLength={4}
              />
              {max > 0 && (
                <span className="text-xs text-muted-foreground">/ {max}</span>
              )}
              <button
                onClick={() => removeRange(entry.id)}
                className="rounded p-1 text-muted-foreground hover:text-danger"
                aria-label="Remove this page range"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={addRange}
            className="gap-1"
          >
            <Plus className="size-4" />
            Add another range
          </Button>

          {/* Summary */}
          {ranges.length > 0 && ranges.some(r => r.from && r.to) && (
            <p className="text-xs text-muted-foreground">
              Selected: {buildRangeString(ranges) ?? 'none'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
