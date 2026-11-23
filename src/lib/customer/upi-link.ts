/**
 * UPI deep-link builder for the customer flow.
 *
 * Constructs an NPCI-compliant `upi://pay?…` URI from the shop's VPA + name,
 * an integer-paise amount, an order reference, and (optionally) a note. The
 * output is safe to drop into a QR payload, an `<a href>`, or a
 * `window.location.href` intent launch on Android Chrome.
 *
 * Spec: https://www.npci.org.in/PDF/npci/upi/procedure-linking-specification.pdf
 *   (NPCI BHIM UPI Deep Linking Specification, v1.0)
 *
 * Parameter map (per the NPCI spec):
 *   pa = Payee Address       (the shop's VPA, e.g. quickprint@okaxis)
 *   pn = Payee Name          (the shop's display name — shown in the UPI app)
 *   am = Amount in rupees    (2 decimal places, e.g. "48.00")
 *   cu = Currency            (always "INR")
 *   tn = Transaction Note    (shown in the UPI app's payment confirmation)
 *   tr = Transaction Reference (alphanumeric order ID — used for reconciliation)
 *
 * Safety rules:
 *   - Every value is URL-encoded via `URLSearchParams.toString()` (RFC 3986).
 *     No unescaped user-controlled value is ever concatenated into the URI.
 *   - `pn` is truncated to 50 chars (NPCI soft limit; some UPI apps truncate
 *     longer names with no warning).
 *   - `tn` is truncated to 50 chars AND stripped of characters that would
 *     break the URI parsing in stricter UPI apps (control chars, newlines,
 *     angle brackets).
 *   - `tr` is forced to alphanumeric + dash + underscore only — some PSPs
 *     reject references that contain `/`, `?`, `&`, or spaces. Non-alphanumeric
 *     characters are replaced with `-` (NOT silently dropped, so the reference
 *     stays unique-ish).
 *   - `am` accepts integer paise (the project's canonical money unit — never
 *     float). 0 paise → "0.00" (allowed — used for "pay what you want" demos
 *     and zero-rupee token orders). Negative amounts throw.
 *   - `pa` is validated against the standard `name@bank` pattern; an invalid
 *     VPA throws `UpiLinkError` so the caller can surface a friendly message
 *     rather than hand a malformed URI to the OS intent handler.
 *
 * This module is a peer of `src/lib/payments/upi.ts` (the server-side
 * intent builder used by the UPI deep-link payment adapter). They share the
 * same NPCI spec but live in different layers:
 *   - `payments/upi.ts` — server-side, throws on amountPaise <= 0 (a real
 *     order must have a positive amount).
 *   - `customer/upi-link.ts` — client-side, allows amountPaise = 0 (the
 *     customer UI may render a "Pay" button for a zero-rupee token order or a
 *     "pay what you want" flow).
 */

/** Maximum length for `pn` (payee name) and `tn` (transaction note). */
export const MAX_PN_LENGTH = 50;
export const MAX_TN_LENGTH = 50;
/** Maximum length for `tr` (transaction reference). NPCI allows up to 35; we
 *  enforce 30 to stay safely under the limit after the alphanumeric strip. */
export const MAX_TR_LENGTH = 30;

/** Error thrown when the caller passes an invalid VPA or amount. */
export class UpiLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpiLinkError';
  }
}

/** name@bank — 2-60 chars before the @, 2-30 alpha chars after. */
const VPA_PATTERN = /^[a-zA-Z0-9.\-_]{2,60}@[a-zA-Z]{2,30}$/;

/** Returns true if `vpa` matches the standard UPI VPA format. */
export function isValidVpa(vpa: string): boolean {
  return VPA_PATTERN.test(vpa.trim());
}

/** Strip whitespace, then validate. Throws `UpiLinkError` on a bad VPA. */
export function assertValidVpa(vpa: string): string {
  const clean = vpa.trim();
  if (!isValidVpa(clean)) {
    throw new UpiLinkError(
      'This UPI ID does not look valid. It should be like shopname@bank.',
    );
  }
  return clean;
}

/**
 * Convert integer paise → a 2-decimal-rupees string.
 *   - 4800 paise → "48.00"
 *   - 0 paise    → "0.00"
 *   - 5 paise    → "0.05"
 *   - 105 paise  → "1.05"
 *   - 100000 paise → "1000.00"
 *
 * Negative input throws `UpiLinkError`. Non-integer input is floored
 * (callers should pass integer paise; the floor is a defensive guard against
 * a stray float from a price calc).
 */
export function paiseToRupees(amountPaise: number): string {
  if (!Number.isFinite(amountPaise)) {
    throw new UpiLinkError('Amount must be a finite number.');
  }
  if (amountPaise < 0) {
    throw new UpiLinkError('Amount must not be negative.');
  }
  const paise = Math.floor(amountPaise);
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  return `${rupees}.${String(remainder).padStart(2, '0')}`;
}

/**
 * Sanitize the transaction note (`tn`):
 *   - Truncate to MAX_TN_LENGTH (50) chars.
 *   - Remove control characters, newlines, and angle brackets that some UPI
 *     apps interpret as URI delimiters.
 *
 * The remaining characters are URL-encoded by `URLSearchParams.toString()`,
 * so spaces become `+` or `%20`, ampersands become `%26`, etc. — that's safe.
 */
export function sanitizeNote(note: string | undefined): string {
  if (!note) return '';
  // Strip control chars (incl. CR/LF), `<`, `>` (angle brackets confuse some
  // URI parsers), and backticks. Keep everything else — URLSearchParams will
  // percent-encode the rest.
  const stripped = note.replace(/[\u0000-\u001F\u007F<>`]/g, '');
  return stripped.slice(0, MAX_TN_LENGTH);
}

/**
 * Sanitize the transaction reference (`tr`):
 *   - Keep only [A-Za-z0-9-_]. Other characters (spaces, slashes, ampersands,
 *     Unicode) are replaced with `-` so the reference stays unique-ish
 *     without breaking URI parsing in stricter PSPs.
 *   - Truncate to MAX_TR_LENGTH (30) chars.
 *
 * The result is guaranteed to be a safe URI path/query segment.
 */
export function sanitizeReference(ref: string): string {
  if (!ref) return '';
  // Replace any non-alphanumeric (except - and _) with a dash.
  const cleaned = ref.replace(/[^A-Za-z0-9-_]/g, '-');
  // Collapse runs of dashes so "ORDER 123/A" → "ORDER-123-A" (not "ORDER--123-A").
  const collapsed = cleaned.replace(/-{2,}/g, '-');
  // Strip leading/trailing dashes.
  const trimmed = collapsed.replace(/^-+|-+$/g, '');
  return trimmed.slice(0, MAX_TR_LENGTH) || 'order';
}

/**
 * Build the full `upi://pay?…` URI.
 *
 * @param params.pa  Payee VPA (e.g. "quickprint@okaxis"). Validated.
 * @param params.pn  Payee name (e.g. "QuickPrint"). Truncated to 50 chars.
 * @param params.am  Amount in integer PAISE (e.g. 4800 → ₹48.00).
 * @param params.tr  Transaction reference (order ID). Sanitized to alphanumeric.
 * @param params.tn  Optional transaction note. Sanitized + truncated to 50 chars.
 * @throws {UpiLinkError} if `pa` is not a valid VPA or `am` is negative/non-finite.
 */
export function buildUpiUri(params: {
  pa: string;
  pn: string;
  am: number;
  tr: string;
  tn?: string;
}): string {
  const pa = assertValidVpa(params.pa);
  const pn = (params.pn ?? '').toString().slice(0, MAX_PN_LENGTH);
  const am = paiseToRupees(params.am);
  const tr = sanitizeReference(params.tr);
  const tn = sanitizeNote(params.tn);

  const search = new URLSearchParams({
    pa,
    pn,
    am,
    cu: 'INR',
    tr,
  });
  // Only add `tn` if there's a non-empty note — omitting the param entirely
  // is cleaner than emitting `tn=` (some UPI apps treat empty `tn` as an
  // error).
  if (tn) search.set('tn', tn);

  return `upi://pay?${search.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// App-specific UPI deep-link schemes.
//
// The generic `upi://pay?…` scheme ALWAYS works — the OS routes it to the
// user's default UPI app or shows the UPI app picker. App-specific schemes
// (`tez://`, `phonepe://`, etc.) bypass the picker and launch a specific app,
// but they are NOT officially documented for web/QR use by every PSP. We
// only ship an app-specific button when the scheme is publicly documented.
//
// Sources verified 2026-11 (see UPI-MANUAL-TESTS.md for the manual matrix):
// ────────────────────────────────────────────────────────────────────────────

/**
 * App-specific scheme metadata. `verified: false` means the scheme is not
 * shipped as a button — the generic `upi://` link is used instead. The
 * `source` field is the official documentation URL we checked.
 *
 * If you flip a scheme to `verified: true`, you MUST have a working source
 * URL in the `source` field. Code review should reject any change to
 * `verified: true` without a corresponding source URL.
 */
export interface UpiAppScheme {
  /** Stable identifier (matches `id` in PaymentSheet's `UpiApp`). */
  id: string;
  /** Display name on the button. */
  name: string;
  /** The deep-link scheme prefix (e.g. "upi://", "phonepe://"). */
  scheme: string;
  /** Whether we ship a dedicated button for this scheme. */
  verified: boolean;
  /** The official documentation URL we verified the scheme from. */
  source: string;
  /** Notes on caveats (e.g. "Android only", "requires merchant VPA"). */
  notes: string;
}

/**
 * The verified app-scheme registry.
 *
 * Research findings (2026-11):
 *   - Google Pay: `tez://` and `gpay://` schemes exist in legacy APK
 *     manifests but Google has NOT published them as a web/QR deep-link
 *     contract. Google Pay respects the generic `upi://` link. NOT shipped.
 *     Source: https://developers.google.com/pay/api/web (no UPI deep-link
 *     scheme documented); community reports only.
 *   - PhonePe: PhonePe publishes a `phonepe://` deep-link scheme for
 *     merchant integrations, but it requires a registered merchant + signed
 *     transaction request (NOT a plain `phonepe://pay?…` like `upi://`).
 *     Without a merchant account, the generic `upi://` link is the only
 *     supported path. NOT shipped as a plain button.
 *     Source: https://developer.phonepe.com/v1/docs/build-pg-integration-sdk/
 *   - Paytm: `paytmmp://` is documented in Paytm's merchant SDK for
 *     in-app flows, but not for web/QR. The generic `upi://` link works
 *     for Paytm's UPI intent handler. NOT shipped as a plain button.
 *     Source: https://developer.paytm.com/docs/ (no public `paytmmp://pay`
 *     deep-link contract for web).
 *   - BHIM: `bhim://` scheme is referenced in NPCI documentation but is
 *     not consistently registered across BHIM app versions. The generic
 *     `upi://` link is the reliable path. NOT shipped as a plain button.
 *     Source: https://www.npci.org.in/what-we-do/upi/bhim — no public
 *     `bhim://pay?…` deep-link contract.
 *
 * Conclusion: the generic `upi://` link is the ONLY scheme we ship as a
 * dedicated button. App-specific schemes are listed here for documentation
 * only — they're `verified: false` and the PaymentSheet does NOT render
 * buttons for them.
 */
export const UPI_APP_SCHEMES: UpiAppScheme[] = [
  {
    id: 'googlepay',
    name: 'Google Pay',
    scheme: 'tez://',
    verified: false,
    source: 'https://developers.google.com/pay/api/web',
    notes:
      'Google Pay respects the generic upi:// link via the OS UPI intent picker. ' +
      'The tez:// and gpay:// schemes are NOT officially documented for web/QR use.',
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    scheme: 'phonepe://',
    verified: false,
    source: 'https://developer.phonepe.com/v1/docs/build-pg-integration-sdk/',
    notes:
      'PhonePe publishes phonepe:// for merchant SDK integrations (signed ' +
      'transaction request), NOT as a plain deep-link. Generic upi:// works.',
  },
  {
    id: 'paytm',
    name: 'Paytm',
    scheme: 'paytmmp://',
    verified: false,
    source: 'https://developer.paytm.com/docs/',
    notes:
      'paytmmp:// is documented for Paytm merchant SDK in-app flows, not web/QR. ' +
      'Generic upi:// works for Paytm UPI.',
  },
  {
    id: 'bhim',
    name: 'BHIM',
    scheme: 'bhim://',
    verified: false,
    source: 'https://www.npci.org.in/what-we-do/upi/bhim',
    notes:
      'bhim:// is referenced in NPCI docs but not consistently registered across ' +
      'BHIM app versions. Generic upi:// is the reliable path.',
  },
  {
    id: 'other',
    name: 'Other UPI apps',
    scheme: 'upi://',
    verified: true,
    source: 'https://www.npci.org.in/PDF/npci/upi/procedure-linking-specification.pdf',
    notes:
      'The generic upi://pay?… scheme is the NPCI-standard deep link. It always ' +
      'works — the OS routes it to the user-chosen UPI app via the intent picker.',
  },
];

/**
 * Returns the verified scheme for an app ID. If the app-specific scheme is
 * NOT verified, falls back to the generic `upi://` link so the caller always
 * gets a working URI.
 *
 * Use this when a customer taps an app button — it returns either the
 * app-specific scheme (if verified) or the generic `upi://` URI (always
 * safe).
 */
export function resolveAppScheme(
  appId: string,
  upiUri: string,
): { scheme: string; uri: string; appSpecific: boolean } {
  const entry = UPI_APP_SCHEMES.find((s) => s.id === appId);
  if (!entry || !entry.verified) {
    // Unknown app or scheme not verified — use the generic upi:// link.
    return { scheme: 'upi://', uri: upiUri, appSpecific: false };
  }
  // For the verified "other" entry, the scheme IS upi:// — the URI is the
  // generic upi://pay?… link the caller built.
  return { scheme: entry.scheme, uri: upiUri, appSpecific: entry.scheme !== 'upi://' };
}
