/**
 * Discovery formatting helper — rupees from integer paise.
 * Mirrors formatRupees from the Clear price-breakdown component so the
 * discovery layer has one canonical money formatter.
 */
export function formatRupeesFromPaise(paise: number | null | undefined): string {
  if (paise == null) return '—';
  const rs = paise / 100;
  const str = rs % 1 === 0 ? rs.toFixed(0) : rs.toFixed(2).replace(/0$/, '');
  return `₹${str}`;
}
