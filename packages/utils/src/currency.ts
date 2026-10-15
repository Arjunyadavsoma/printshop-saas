/**
 * Currency helpers for the Indian market. All money lives as integer paise
 * internally; these helpers are the only place we touch INR strings.
 */

/** Number of paise in one rupee. */
export const PAISE_PER_RUPEE = 100;

/**
 * Format paise as a human-readable INR string with the ₹ symbol and Indian
 * digit grouping (e.g. `123456` paise → `₹1,234.56`).
 *
 * @param paise - a non-negative integer paise value
 * @returns the formatted string
 */
export function formatINRFromPaise(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(`formatINRFromPaise: expected non-negative integer paise, got ${paise}`);
  }
  const rupees = paise / PAISE_PER_RUPEE;
  // en-IN gives the 1,00,000 lakh grouping.
  const grouped = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
  return `₹${grouped}`;
}

/**
 * Parse a rupee string (with or without ₹, commas) into integer paise.
 * Throws if the result isn't a clean number of paise.
 *
 * @param input - e.g. "₹1,234.56" or "100"
 * @returns integer paise
 */
export function parseINRToPaise(input: string): number {
  const cleaned = input.replace(/₹/g, '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`parseINRToPaise: cannot parse "${input}"`);
  }
  const paise = Math.round(n * PAISE_PER_RUPEE);
  if (!Number.isInteger(paise)) {
    throw new Error(`parseINRToPaise: fractional paise from "${input}"`);
  }
  return paise;
}

/** Safe add that rejects non-integers and overflow. */
export function addPaise(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    throw new Error(`addPaise: operands must be non-negative integers, got ${a}, ${b}`);
  }
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`addPaise: overflow at ${a} + ${b}`);
  }
  return sum;
}
