/**
 * Indian phone numbers. The API stores `+91XXXXXXXXXX`; people type it many ways.
 * Returns the normalized form, or null if it is not a 10-digit Indian mobile number (first digit
 * 6 to 9, the same rule as the database CHECK) after stripping spaces, dashes, a leading "+91",
 * "91" or "0".
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^[0-9]+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : null;
}

/** "+919876543210" becomes "+91 98765 43210". Anything else is shown as stored. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const match = /^\+91([0-9]{5})([0-9]{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}
