/**
 * A fresh Idempotency-Key for one payment attempt (API.md section 1: 16-128 chars of
 * letters, digits, "_" and "-"). The caller keeps the SAME key for retries of the same request
 * and makes a new one only when the request body changes.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
