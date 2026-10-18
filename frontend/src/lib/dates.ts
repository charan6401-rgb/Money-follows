/**
 * Business dates are calendar dates in IST (Asia/Kolkata), DATABASE.md section 1.
 * Dates travel as "YYYY-MM-DD" strings and are never converted through the device time zone.
 */

const IST = 'Asia/Kolkata';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Earliest invoice date the API accepts (API.md section 5.1). */
export const MIN_INVOICE_DATE = '2000-01-01';

function partsInIst(instant: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) out[part.type] = part.value;
  return out;
}

/** Today's calendar date in IST as "YYYY-MM-DD". */
export function todayIST(now: Date = new Date()): string {
  const p = partsInIst(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

/** "2026-10-31" -> "31-10-2026". Unknown input is returned unchanged. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = ISO_DATE.exec(value);
  if (!match) return value;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Whole days from a to b (b minus a), both "YYYY-MM-DD". */
export function daysBetween(a: string, b: string): number {
  const toUtc = (v: string) => {
    const m = ISO_DATE.exec(v);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** ISO instant -> "31-10-2026 16:05" in IST. */
export function formatDateTime(instant: string | null | undefined): string {
  if (!instant) return '';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  const p = partsInIst(date);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** "2026-10-01" plus 30 days is "2026-10-31". Calendar arithmetic only, no time zone involved. */
export function addDays(value: string, days: number): string {
  const match = ISO_DATE.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}
