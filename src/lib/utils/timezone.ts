/**
 * Timezone-aware "start/end of day" computation.
 *
 * PROBLEM (DB-002): the daily-report route used `targetDate.setHours(0,0,0,0)`
 * which operates in SERVER-LOCAL time (UTC on Vercel). A Kolkata shop's
 * "today" boundary was 05:30 IST (not 00:00 IST), misattributing up to 5h30m
 * of orders to the previous day. Daily reconciliation was wrong.
 *
 * FIX: compute the UTC instants for the shop's timezone-local midnight using
 * Intl.DateTimeFormat (which has full IANA timezone + DST support, no
 * external dependency). This is correct for Asia/Kolkata (UTC+5:30, no DST)
 * AND for any DST-observing timezone.
 *
 * The approach: probe a known UTC instant (the target date at 00:00:00 UTC),
 * read the wall-clock time in the target timezone at that instant via
 * Intl.formatToParts, compute the offset, then derive the UTC instant when
 * the target date's 00:00:00 happens in the target timezone:
 *
 *   offsetMs = wallClockUtcMs - probeUtcMs
 *   startUtcMs = Date.UTC(targetYear, targetMonth-1, targetDay, 0, 0, 0) - offsetMs
 *
 * (If the timezone is east of UTC, midnight in the tz happens EARLIER in UTC,
 * so we subtract the positive offset.)
 */

/**
 * @param dateStr  YYYY-MM-DD string, or null for "today in the shop's tz"
 * @param tz       IANA timezone (e.g. 'Asia/Kolkata')
 * @returns { start: Date (UTC instant of tz-local midnight), end: Date (just before tz-local midnight tomorrow) }
 */
export function getZonedDayBounds(
  dateStr: string | null,
  tz: string,
): { start: Date; end: Date } {
  // Resolve "today" in the shop's timezone if no date was passed.
  const target = dateStr ?? todayInTz(tz);
  // Parse YYYY-MM-DD
  const year = parseInt(target.slice(0, 4), 10);
  const month = parseInt(target.slice(5, 7), 10); // 1-12
  const day = parseInt(target.slice(8, 10), 10);

  // Probe: the target date at 00:00:00 UTC (placeholder — used to measure
  // the timezone's offset at that date).
  const probeUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const probe = new Date(probeUtcMs);

  // Read the wall-clock time in the target timezone at the probe instant.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(probe);
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value ?? '0';
    return parseInt(v, 10);
  };
  let hour = get('hour');
  // Intl can return "24" for midnight in hour12:false mode (some engines).
  if (hour === 24) hour = 0;
  const wallClockUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  const offsetMs = wallClockUtcMs - probeUtcMs;

  // The UTC instant when the target date's 00:00:00 happens in the target tz.
  const startUtcMs = probeUtcMs - offsetMs;
  return {
    start: new Date(startUtcMs),
    end: new Date(startUtcMs + 24 * 60 * 60 * 1000 - 1),
  };
}

/** Returns the current date (YYYY-MM-DD) in the given IANA timezone. */
function todayInTz(tz: string): string {
  // en-CA gives YYYY-MM-DD format.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
