/**
 * Direct-UPI payment helpers (Phase 3) — intent-link builder + validation.
 *
 * IMPORTANT (brief §4.6): the platform NEVER claims a payment is verified.
 * The customer pays the SHOP's own VPA directly; verification is the
 * shopkeeper's confirmation (PaymentVerifier, MANUAL default). An automatic
 * verifier (gateway webhook) can implement the same interface later.
 */

export class UpiValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'UpiValidationError'; }
}

/** name@bank — 2-60 chars, letters/digits/dots/dashes before the @. */
export function isValidUpiId(upi: string): boolean {
  return /^[a-zA-Z0-9.\-_]{2,60}@[a-zA-Z]{2,30}$/.test(upi);
}

export function assertValidUpiId(upi: string): string {
  const clean = upi.trim();
  if (!isValidUpiId(clean)) {
    throw new UpiValidationError('This UPI ID does not look valid. It should be like shopname@bank.');
  }
  return clean;
}

/** UTR: exactly 12 digits. */
export function isValidUtr(utr: string): boolean {
  return /^\d{12}$/.test(utr.trim());
}

/** Build the upi:// intent link. Amount is integer PAISE (no floats anywhere). */
export function buildUpiIntentUrl(params: {
  payeeUpi: string;
  payeeName: string;
  amountPaise: number;
  orderShortId: string;
}): string {
  const payeeVpa = assertValidUpiId(params.payeeUpi);
  if (params.amountPaise <= 0) {
    throw new UpiValidationError('Amount must be positive.');
  }
  const rupees = Math.floor(params.amountPaise / 100);
  const paise = params.amountPaise % 100;
  const am = `${rupees}.${String(paise).padStart(2, '0')}`;
  const q = new URLSearchParams({
    pa: payeeVpa,
    pn: params.payeeName.slice(0, 50),
    am,
    cu: 'INR',
    tn: params.orderShortId.slice(0, 50),
  });
  return `upi://pay?${q.toString()}`;
}

/** Payment verification strategy. MANUAL is the default: the shopkeeper
 *  confirms. A gateway adapter (webhook verifier) plugs in here later. */
export interface PaymentVerifier {
  readonly mode: 'MANUAL' | 'AUTO';
  /** For AUTO verifiers: confirm a SUBMITTED payment returns VERIFIED/REJECTED/UNKNOWN. */
  verify?(input: { utr: string; amountPaise: number }): Promise<'VERIFIED' | 'REJECTED' | 'UNKNOWN'>;
}

export const ManualVerifier: PaymentVerifier = { mode: 'MANUAL' };
