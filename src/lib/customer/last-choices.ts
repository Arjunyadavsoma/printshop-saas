/**
 * last-choices — remember the customer's last print options per shop.
 *
 * Returning customers get smart defaults: the preset they used last time is
 * pre-selected when a new file becomes ready. This is per-shop (a customer
 * who prints B&W notes at the college print shop and colour photos at the
 * studio print shop keeps both defaults).
 *
 * Storage: localStorage key `printshop_last_choices_${shopSlug}`.
 *
 * The "Mix" preset is NOT remembered — it's file-specific (the colour page
 * selection depends on which pages of which file are colourful). When the
 * last saved preset was 'mix', `loadLastChoices` falls back to 'notes' so
 * the customer gets a sensible default instead of being forced into the
 * Mix page strip.
 *
 * SSR-safe: every function is a no-op / returns null when `window` is
 * undefined.
 */

const KEY_PREFIX = 'printshop_last_choices_';
const MAX_AGE_MS = 100 * 24 * 60 * 60 * 1000; // 100 days

/** The shape persisted to localStorage. */
export interface LastChoices {
  /** 'notes' | 'colour' | 'photo' | 'mix' — but 'mix' is normalised to 'notes' on read. */
  preset: string;
  copies: number;
  paperSize: string;
  sides: string;
  pagesPerSheet: number;
  /** Epoch ms — when the choices were saved. Used to expire stale entries. */
  savedAt: number;
}

/** The input shape — without `savedAt` (the saver stamps it). */
export type LastChoicesInput = Omit<LastChoices, 'savedAt'>;

/**
 * Save the customer's last print choices for a shop. Overwrites any prior
 * entry for the same shopSlug. Stamps `savedAt: Date.now()`.
 *
 * Note: the caller may pass `preset: 'mix'` — we store it as-is. The
 * normalisation to 'notes' happens on READ, not on write, so we don't lose
 * the customer's intent if they later switch to a preset we DO remember.
 */
export function saveLastChoices(shopSlug: string, choices: LastChoicesInput): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: LastChoices = { ...choices, savedAt: Date.now() };
    window.localStorage.setItem(KEY_PREFIX + shopSlug, JSON.stringify(payload));
  } catch {
    // localStorage may be unavailable (private mode / quota) — silently skip.
  }
}

/**
 * Load the customer's last print choices for a shop. Returns null when no
 * entry exists, when storage is unavailable, when the entry is malformed,
 * or when the entry is older than 100 days.
 *
 * If the saved preset was 'mix', it is normalised to 'notes' (the spec's
 * "fall back to Notes BW" rule — Mix is file-specific and shouldn't be
 * auto-applied to a new file).
 */
export function loadLastChoices(shopSlug: string): LastChoices | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + shopSlug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastChoices>;
    if (
      typeof parsed.preset !== 'string' ||
      typeof parsed.copies !== 'number' ||
      typeof parsed.paperSize !== 'string' ||
      typeof parsed.sides !== 'string' ||
      typeof parsed.pagesPerSheet !== 'number'
    ) {
      return null;
    }
    // Expire stale entries (> 100 days).
    if (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      return null;
    }
    // The "Mix" preset is NOT remembered — fall back to "Notes BW".
    const preset = parsed.preset === 'mix' ? 'notes' : parsed.preset;
    return {
      preset,
      copies: parsed.copies,
      paperSize: parsed.paperSize,
      sides: parsed.sides,
      pagesPerSheet: parsed.pagesPerSheet,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Remove the saved choices for a shop (e.g. from a "clear my data" UI). */
export function clearLastChoices(shopSlug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY_PREFIX + shopSlug);
  } catch {
    // ignore
  }
}
