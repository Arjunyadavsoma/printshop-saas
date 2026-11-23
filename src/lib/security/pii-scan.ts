/**
 * P9-Security §5 — PII scanner for analytics payloads.
 *
 * The analytics pipeline is unauthenticated; the server cannot trust the
 * client's privacy contract. This module scans every event name + property
 * key + property value for known PII patterns and returns the findings so
 * the route can reject the batch atomically.
 *
 * Patterns detected:
 *   - 10-digit Indian mobile numbers (optionally prefixed with +91 or 0).
 *     Pattern: (?<!\d)(?:\+91|0)?[6-9]\d{9}(?!\d)
 *     The [6-9] start digit is the Indian mobile range (Jio/Airtel/Vi/BSNL).
 *   - 12-digit UTR / UPI reference numbers.
 *     Pattern: (?<!\d)\d{12}(?!\d)
 *     Note: this also matches 12-digit order IDs / UUIDs without dashes,
 *     which is acceptable — both are credentials we should not log.
 *   - Email addresses: local-part@domain.tld.
 *   - File names with extensions: *.pdf, *.docx, *.jpg, *.png, *.xlsx,
 *     *.pptx, *.doc, *.txt, *.heic, *.zip, *.gif, *.webp.
 *   - Order tokens: 32+ hex chars in a row (a leaked 128-bit token is a
 *     credential leak — anyone with the URL can track/cancel the order).
 *
 * The scanner returns the list of findings (each a short label like
 * "phone", "utr", "email", "filename", "token"). An empty array means the
 * input is PII-free.
 *
 * The scanner is INTENTIONALLY conservative — false positives are better
 * than false negatives here (we'd rather reject a clean event than leak
 * PII). If a legitimate analytics property trips a pattern, the fix is to
 * redesign the property (e.g. bucket a phone-number-based "loyalty tier"
 * into a coarse-grained string), not to weaken the scanner.
 */

export type PiiKind = 'phone' | 'utr' | 'email' | 'filename' | 'token';

export interface PiiFinding {
  kind: PiiKind;
  /** The matched substring (so the operator can see what was flagged). */
  match: string;
}

// Pre-compiled regexes. The `g` flag is set so we can find every match in a
// string (not just the first). The lookbehind/lookahead `(?<!\d)` / `(?!\d)`
// prevent matching the middle of a longer digit run (e.g. the 12-digit
// pattern must not match the middle 12 digits of a 20-digit run).
const PHONE_RE = /(?<!\d)(?:\+91|0)?[6-9]\d{9}(?!\d)/g;
const UTR_RE = /(?<!\d)\d{12}(?!\d)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// File extensions we treat as sensitive — uploading `resume.pdf` leaks the
// customer's intent (job hunting). The list is conservative: common document
// + image formats. Notably we do NOT flag `.js` / `.ts` / `.json` (dev
// artifacts that show up in browser-version strings) — only user-content
// extensions.
const FILENAME_RE = /\b[\w.-]+\.(?:pdf|docx?|pptx?|xlsx?|jpe?g|png|gif|webp|heic|heif|txt|zip|rar|7z)\b/gi;
// Order token: 32+ hex chars in a row. crypto.randomUUID().replace(/-/g, '')
// produces 32 hex chars; the upload-init route concatenates two UUIDs = 64
// hex chars. Both match this pattern.
const TOKEN_RE = /[a-f0-9]{32,}/gi;

/**
 * Scan a single string for PII patterns. Returns the list of findings
 * (empty array if the string is clean).
 */
export function detectPii(input: string): PiiFinding[] {
  if (!input || typeof input !== 'string') return [];
  const findings: PiiFinding[] = [];
  let m: RegExpExecArray | null;

  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(input)) !== null) {
    findings.push({ kind: 'phone', match: m[0] });
  }

  UTR_RE.lastIndex = 0;
  while ((m = UTR_RE.exec(input)) !== null) {
    findings.push({ kind: 'utr', match: m[0] });
  }

  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(input)) !== null) {
    findings.push({ kind: 'email', match: m[0] });
  }

  FILENAME_RE.lastIndex = 0;
  while ((m = FILENAME_RE.exec(input)) !== null) {
    findings.push({ kind: 'filename', match: m[0] });
  }

  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    findings.push({ kind: 'token', match: m[0] });
  }

  return findings;
}

/**
 * Scan an entire analytics event — name + every property key + every
 * property value. Returns the list of findings.
 *
 * Property values are coerced to strings before scanning (a number like
 * 9876543210 is just as much a phone number as the string "9876543210").
 */
export function detectPiiInEvent(event: {
  event: string;
  properties?: Record<string, unknown>;
}): PiiFinding[] {
  const findings: PiiFinding[] = [];
  if (event.event) findings.push(...detectPii(event.event));
  if (event.properties) {
    for (const [key, value] of Object.entries(event.properties)) {
      findings.push(...detectPii(key));
      if (typeof value === 'string') {
        findings.push(...detectPii(value));
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        findings.push(...detectPii(String(value)));
      }
    }
  }
  return findings;
}

/**
 * Scan a batch of events. Returns a map of event-index → findings, so the
 * caller can return a helpful error pointing at the offending event(s).
 */
export function detectPiiInBatch(events: Array<{ event: string; properties?: Record<string, unknown> }>): Array<{ index: number; findings: PiiFinding[] }> {
  const out: Array<{ index: number; findings: PiiFinding[] }> = [];
  events.forEach((evt, index) => {
    const findings = detectPiiInEvent(evt);
    if (findings.length > 0) out.push({ index, findings });
  });
  return out;
}
