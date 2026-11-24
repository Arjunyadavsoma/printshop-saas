/**
 * Opening-hours engine for shop discovery.
 *
 * Pure functions (no imports from app code). All "now" math is done in the
 * shop's own IANA timezone via Intl — never the server's local time.
 *
 * Stored shape (Shop.openingHours, Json): one entry per weekday key, each
 * a list of sessions so split hours (e.g. 09:00–13:00 + 16:00–21:00) work.
 * A single session object per day is also accepted for backwards
 * compatibility with hand-written rows.
 *
 *   { "mon": [{ "open": "09:00", "close": "21:00" }], "tue": [...], ... }
 *
 * A session whose close time is <= its open time is OVERNIGHT: it runs
 * from `open` on its day until `close` the next morning (e.g. 20:00–02:00).
 * A day with no entry (or an empty list) means closed that day.
 *
 * Manual closure is deliberately SEPARATE from the hours: Shop.isOpen /
 * Shop.acceptingOrders say whether the shopkeeper is taking orders right
 * now; the hours say whether the shop is scheduled to be open. A shop can
 * be inside its hours yet temporarily closed, and the label must say so.
 */

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const DAY_KEYS: readonly DayKey[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];

/** One open session, "HH:MM" 24-hour clock. */
export interface OpeningSession {
  open: string;
  close: string;
}

/** Weekly hours: weekday key → list of sessions (or a single session). */
export type WeeklyOpeningHours = Partial<
  Record<DayKey, OpeningSession[] | OpeningSession>
>;

const DAY_NAMES: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function parseHhMm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Normalise an unknown Json value into per-day session lists. */
export function parseOpeningHours(
  value: unknown,
): Partial<Record<DayKey, OpeningSession[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<DayKey, OpeningSession[]>> = {};
  for (const key of DAY_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw == null) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    const sessions: OpeningSession[] = [];
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      const open = (s as Record<string, unknown>).open;
      const close = (s as Record<string, unknown>).close;
      if (typeof open !== 'string' || typeof close !== 'string') continue;
      if (parseHhMm(open) === null || parseHhMm(close) === null) continue;
      sessions.push({ open, close });
    }
    if (sessions.length > 0) out[key] = sessions;
  }
  return out;
}

interface LocalParts {
  dayKey: DayKey;
  minutes: number; // minutes since local midnight
  /** UTC ms of local midnight — used to step to neighbouring days. */
  dayStartUtcMs: number;
}

function localParts(now: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, DayKey> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun',
  };
  const dayKey = weekdayMap[parts.weekday ?? 'Mon'] ?? 'mon';
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  // Local midnight in UTC ms: take the local calendar date as UTC, then
  // subtract the zone offset (derived by re-formatting that instant).
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
  );
  const probe = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const probeParts = Object.fromEntries(
    probe.formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]),
  );
  const probeMinutes =
    Number(probeParts.hour) * 60 + Number(probeParts.minute);
  // Local time at UTC midnight of the local calendar date: if it falls on
  // the same local date the zone is ahead of UTC (midnight is `probe`
  // before UTC midnight); if it falls on the previous local date the zone
  // is behind UTC (midnight is `24h - probe` after UTC midnight).
  const probeDay = Number(probeParts.day);
  const dayStartUtcMs =
    probeDay === Number(parts.day)
      ? asUtc - probeMinutes * 60_000
      : asUtc + (24 * 60 - probeMinutes) * 60_000;
  return { dayKey, minutes, dayStartUtcMs };
}

function dayKeyAt(dayStartUtcMs: number, timezone: string): DayKey {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date(dayStartUtcMs + 12 * 3_600_000)); // noon: DST-safe
  return (
    ({ Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' }) as Record<string, DayKey>
  )[weekday] ?? 'mon';
}

/** Minutes from `now` until a session starting at `openMinutes` on `dayOffset` days ahead. */
interface NextOpening {
  dayOffset: number; // 0 = today, 1 = tomorrow, …
  openMinutes: number;
}

function findNextOpening(
  hours: Partial<Record<DayKey, OpeningSession[]>>,
  today: DayKey,
  minutesNow: number,
  dayStartUtcMs: number,
  timezone: string,
): NextOpening | null {
  for (let offset = 0; offset < 8; offset++) {
    const key =
      offset === 0
        ? today
        : dayKeyAt(dayStartUtcMs + offset * 86_400_000, timezone);
    const sessions = hours[key] ?? [];
    const sorted = [...sessions].sort(
      (a, b) => (parseHhMm(a.open) ?? 0) - (parseHhMm(b.open) ?? 0),
    );
    for (const s of sorted) {
      const open = parseHhMm(s.open);
      if (open === null) continue;
      if (offset === 0 && open <= minutesNow) continue;
      return { dayOffset: offset, openMinutes: open };
    }
  }
  return null;
}

function formatTime12h(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Is the shop open per its weekly schedule at `now` (in `timezone`)?
 * - No/empty hours → true (no schedule restriction; manual flags decide).
 * - A session covers `now`, including overnight sessions spilling past
 *   midnight from the previous day.
 * Manual closure (isOpen / acceptingOrders) is NOT considered here — see
 * {@link openStatusLabel} / {@link shopOpenStatus}.
 */
export function isShopOpenNow(
  openingHours: unknown,
  timezone = 'Asia/Kolkata',
  now: Date = new Date(),
): boolean {
  const hours = parseOpeningHours(openingHours);
  if (Object.keys(hours).length === 0) return true;
  const { dayKey, minutes, dayStartUtcMs } = localParts(now, timezone);

  // Overnight session from yesterday still running after midnight.
  const prevKey = dayKeyAt(dayStartUtcMs - 86_400_000, timezone);
  for (const s of hours[prevKey] ?? []) {
    const open = parseHhMm(s.open);
    const close = parseHhMm(s.close);
    if (open === null || close === null || close > open) continue;
    if (minutes < close) return true; // before yesterday's close time
  }
  // Today's sessions (incl. overnight ones starting today).
  for (const s of hours[dayKey] ?? []) {
    const open = parseHhMm(s.open);
    const close = parseHhMm(s.close);
    if (open === null || close === null) continue;
    if (close > open) {
      if (minutes >= open && minutes < close) return true;
    } else if (minutes >= open) {
      return true; // overnight session started today, runs past midnight
    }
  }
  return false;
}

export interface OpenStatusOptions {
  /** Shop.isOpen — shopkeeper's manual open/closed toggle. */
  isOpen?: boolean;
  /** Shop.acceptingOrders — false = temporarily not taking orders. */
  acceptingOrders?: boolean;
}

/**
 * Customer-facing open-status label.
 * - Manual closure wins: !isOpen or !acceptingOrders → "Temporarily unavailable".
 * - Open + closing within 60 min → "Closes at 9:00 PM".
 * - Open otherwise → "Open now".
 * - Closed + opens later today → "Opens today at 9:00 AM".
 * - Closed + opens tomorrow → "Opens tomorrow at 9:00 AM".
 * - Closed + opens later in the week → "Opens Monday at 9:00 AM".
 * - No hours at all → "Open now" / "Closed" from the manual flags.
 */
export function openStatusLabel(
  openingHours: unknown,
  timezone = 'Asia/Kolkata',
  now: Date = new Date(),
  opts: OpenStatusOptions = {},
): string {
  const { isOpen = true, acceptingOrders = true } = opts;
  if (!isOpen || !acceptingOrders) return 'Temporarily unavailable';

  const hours = parseOpeningHours(openingHours);
  if (Object.keys(hours).length === 0) return 'Open now';

  const { dayKey, minutes, dayStartUtcMs } = localParts(now, timezone);
  if (isShopOpenNow(openingHours, timezone, now)) {
    // Find when the current session ends (today, or tomorrow for overnight).
    let closesAt: number | null = null;
    const prevKey = dayKeyAt(dayStartUtcMs - 86_400_000, timezone);
    for (const s of hours[prevKey] ?? []) {
      const open = parseHhMm(s.open);
      const close = parseHhMm(s.close);
      if (open === null || close === null || close > open) continue;
      if (minutes < close) closesAt = close + 24 * 60;
    }
    if (closesAt === null) {
      for (const s of hours[dayKey] ?? []) {
        const open = parseHhMm(s.open);
        const close = parseHhMm(s.close);
        if (open === null || close === null) continue;
        const inSession =
          close > open
            ? minutes >= open && minutes < close
            : minutes >= open;
        if (inSession) {
          closesAt = close > open ? close : close + 24 * 60;
          break;
        }
      }
    }
    if (closesAt !== null) {
      const minsToClose = closesAt - minutes;
      if (minsToClose <= 60) {
        return `Closes at ${formatTime12h(closesAt)}`;
      }
    }
    return 'Open now';
  }

  const next = findNextOpening(hours, dayKey, minutes, dayStartUtcMs, timezone);
  if (!next) return 'Closed';
  const time = formatTime12h(next.openMinutes);
  if (next.dayOffset === 0) return `Opens today at ${time}`;
  if (next.dayOffset === 1) return `Opens tomorrow at ${time}`;
  const key = dayKeyAt(dayStartUtcMs + next.dayOffset * 86_400_000, timezone);
  return `Opens ${DAY_NAMES[key]} at ${time}`;
}

/** Combined schedule + manual-flag status for a shop row. */
export function shopOpenStatus(
  shop: {
    openingHours?: unknown;
    timezone?: string | null;
    isOpen?: boolean | null;
    acceptingOrders?: boolean | null;
  },
  now: Date = new Date(),
): { open: boolean; label: string } {
  const timezone = shop.timezone ?? 'Asia/Kolkata';
  const isOpen = shop.isOpen ?? true;
  const acceptingOrders = shop.acceptingOrders ?? true;
  const scheduledOpen = isShopOpenNow(shop.openingHours, timezone, now);
  const open = isOpen && acceptingOrders && scheduledOpen;
  const label = openStatusLabel(shop.openingHours, timezone, now, {
    isOpen,
    acceptingOrders,
  });
  return { open, label };
}
