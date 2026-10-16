/**
 * Money helpers. All money is integer paise (DECISIONS.md D-10).
 * Binary floating point is never used for amounts: rupee strings are split and padded as text.
 * The server stays authoritative; this module only mirrors its input rule for early feedback.
 */

/** Upper bound from DATABASE.md section 1 (also a safe JavaScript integer). */
export const MAX_PAISE = 99_999_999_999_999;

/** Same shape the API accepts (API.md section 1): up to 12 digits, optional 1-2 decimals. */
const RUPEE_INPUT = /^[0-9]{1,12}(\.[0-9]{1,2})?$/;

export function isValidRupeeString(input: string): boolean {
  return RUPEE_INPUT.test(input.trim());
}

/**
 * "12500.5" -> 1250050. Returns null when the text breaks the money rule
 * (commas, exponent, sign, more than two decimals, empty).
 */
export function rupeeStringToPaise(input: string): number | null {
  const text = input.trim();
  if (!RUPEE_INPUT.test(text)) return null;
  const [rupeePart = '0', fraction = ''] = text.split('.');
  const paise = Number(rupeePart) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise <= MAX_PAISE ? paise : null;
}

/** 1250050 -> "12500.50". Used to prefill an amount field. */
export function paiseToRupeeString(paise: number): string {
  const safe = Math.max(0, Math.trunc(paise));
  const rupees = Math.floor(safe / 100);
  const rest = safe % 100;
  return `${rupees}.${String(rest).padStart(2, '0')}`;
}

/** Indian digit grouping: 12500050 -> "1,25,00,050" style (last three, then pairs). */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) parts.unshift(rest);
  return [...parts, lastThree].join(',');
}

export interface PaiseParts {
  negative: boolean;
  rupees: string;
  paise: string;
}

export function splitPaise(paise: number): PaiseParts {
  const value = Number.isSafeInteger(paise) ? paise : 0;
  const negative = value < 0;
  const abs = Math.abs(value);
  return {
    negative,
    rupees: groupIndian(String(Math.floor(abs / 100))),
    paise: String(abs % 100).padStart(2, '0'),
  };
}

/** 12500050 -> "₹1,25,000.50" */
export function formatPaise(paise: number): string {
  const p = splitPaise(paise);
  return `${p.negative ? '-' : ''}₹${p.rupees}.${p.paise}`;
}
