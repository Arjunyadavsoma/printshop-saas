import { describe, it, expect } from 'vitest';
import { pagesToRanges, formatRange, parseRangeString, parsePageRange, resolveBillablePages } from './page-selection';

describe('pagesToRanges', () => {
  it('converts a contiguous run into a single range', () => {
    expect(pagesToRanges([1, 2, 3, 4, 5])).toEqual([{ from: 1, to: 5 }]);
  });

  it('splits non-contiguous pages into multiple ranges', () => {
    expect(pagesToRanges([1, 2, 3, 5, 6, 8])).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 6 },
      { from: 8, to: 8 },
    ]);
  });

  it('handles a single page', () => {
    expect(pagesToRanges([7])).toEqual([{ from: 7, to: 7 }]);
  });

  it('handles empty input', () => {
    expect(pagesToRanges([])).toEqual([]);
  });

  it('sorts unsorted input', () => {
    expect(pagesToRanges([8, 1, 5, 2, 6, 3])).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 6 },
      { from: 8, to: 8 },
    ]);
  });

  it('de-duplicates duplicate pages', () => {
    expect(pagesToRanges([1, 1, 2, 2, 3])).toEqual([{ from: 1, to: 3 }]);
  });
});

describe('formatRange', () => {
  it('formats a multi-page range as from-to', () => {
    expect(formatRange({ from: 1, to: 5 })).toBe('1-5');
  });

  it('formats a single page without a dash', () => {
    expect(formatRange({ from: 8, to: 8 })).toBe('8');
  });
});

describe('parseRangeString', () => {
  it('parses a valid range string into range tuples', () => {
    expect(parseRangeString('1-5,8,10-12', 30)).toEqual([
      { from: 1, to: 5 },
      { from: 8, to: 8 },
      { from: 10, to: 12 },
    ]);
  });

  it('returns null for an empty string', () => {
    expect(parseRangeString('', 30)).toBeNull();
  });

  it('returns null for a malformed range', () => {
    expect(parseRangeString('abc', 30)).toBeNull();
  });

  it('returns null for out-of-bounds pages', () => {
    expect(parseRangeString('1-999', 30)).toBeNull();
  });
});

describe('parsePageRange — comprehensive range validation', () => {
  it('parses a single page', () => {
    expect(parsePageRange('15', 30)).toEqual([15]);
  });

  it('parses a continuous range', () => {
    expect(parsePageRange('1-5', 30)).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses comma-separated pages', () => {
    expect(parsePageRange('1,3,5', 30)).toEqual([1, 3, 5]);
  });

  it('parses mixed ranges and singles', () => {
    expect(parsePageRange('1-5,8,12-14', 30)).toEqual([1, 2, 3, 4, 5, 8, 12, 13, 14]);
  });

  it('tolerates whitespace', () => {
    expect(parsePageRange('1-5, 8, 12-14', 30)).toEqual([1, 2, 3, 4, 5, 8, 12, 13, 14]);
  });

  it('de-duplicates overlapping ranges', () => {
    expect(parsePageRange('1-5,3-7', 30)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('de-duplicates duplicate pages', () => {
    expect(parsePageRange('1,1,2,2,3', 30)).toEqual([1, 2, 3]);
  });

  it('sorts out-of-order input', () => {
    expect(parsePageRange('10,5,1-3', 30)).toEqual([1, 2, 3, 5, 10]);
  });

  it('handles adjacent ranges that merge', () => {
    expect(parsePageRange('1-3,4-6', 30)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  // Invalid cases
  it('rejects reversed ranges', () => {
    expect(parsePageRange('5-2', 30)).toBeNull();
  });

  it('rejects zero pages', () => {
    expect(parsePageRange('0', 30)).toBeNull();
  });

  it('rejects negative pages', () => {
    expect(parsePageRange('-1', 30)).toBeNull();
  });

  it('rejects out-of-bounds pages', () => {
    expect(parsePageRange('1-999', 30)).toBeNull();
  });

  it('rejects decimal values', () => {
    expect(parsePageRange('1.5', 30)).toBeNull();
  });

  it('rejects malformed syntax', () => {
    expect(parsePageRange('1-2-3', 30)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parsePageRange('', 30)).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parsePageRange('abc', 30)).toBeNull();
  });

  it('rejects dangling dash', () => {
    expect(parsePageRange('1-', 30)).toBeNull();
  });
});

describe('resolveBillablePages', () => {
  it('returns all pages when no range is specified', () => {
    const result = resolveBillablePages(null, 30);
    expect('billablePages' in result).toBe(true);
    if ('billablePages' in result) {
      expect(result.billablePages).toBe(30);
      expect(result.selectedPages).toBeNull();
    }
  });

  it('returns all pages for empty string range', () => {
    const result = resolveBillablePages('', 30);
    expect('billablePages' in result).toBe(true);
    if ('billablePages' in result) {
      expect(result.billablePages).toBe(30);
    }
  });

  it('returns the selected count for a valid range', () => {
    const result = resolveBillablePages('1-5,8,12-14', 30);
    expect('billablePages' in result).toBe(true);
    if ('billablePages' in result) {
      expect(result.billablePages).toBe(9); // 5 + 1 + 3
    }
  });

  it('de-duplicates overlapping ranges in billable count', () => {
    const result = resolveBillablePages('1-5,3-7', 30);
    expect('billablePages' in result).toBe(true);
    if ('billablePages' in result) {
      expect(result.billablePages).toBe(7); // not 10
    }
  });

  it('returns an error for invalid ranges', () => {
    const result = resolveBillablePages('abc', 30);
    expect('error' in result).toBe(true);
  });

  it('returns an error for out-of-bounds ranges', () => {
    const result = resolveBillablePages('1-999', 30);
    expect('error' in result).toBe(true);
  });

  it('returns an error when a range is supplied but pageCount is null', () => {
    const result = resolveBillablePages('1-5', null);
    expect('error' in result).toBe(true);
  });

  it('defaults to 1 page when pageCount is null and no range', () => {
    const result = resolveBillablePages(null, null);
    expect('billablePages' in result).toBe(true);
    if ('billablePages' in result) {
      expect(result.billablePages).toBe(1);
    }
  });
});
