import { describe, expect, it } from 'vitest';
import { daysBetween, formatDate, formatDateTime, isIsoDate, todayIST } from './dates';

describe('todayIST', () => {
  it('uses the IST calendar day, not the UTC day', () => {
    // 2026-10-13 20:00 UTC is already 2026-10-14 01:30 in IST.
    expect(todayIST(new Date('2026-10-13T20:00:00Z'))).toBe('2026-10-14');
  });

  it('stays on the same day just before IST midnight', () => {
    // 18:29 UTC is 23:59 IST.
    expect(todayIST(new Date('2026-10-13T18:29:00Z'))).toBe('2026-10-13');
  });

  it('rolls over exactly at IST midnight', () => {
    expect(todayIST(new Date('2026-10-13T18:30:00Z'))).toBe('2026-10-14');
  });

  it('handles the financial-year boundary', () => {
    expect(todayIST(new Date('2026-03-31T18:30:00Z'))).toBe('2026-04-01');
  });
});

describe('isIsoDate', () => {
  it.each(['2026-10-31', '2024-02-29', '2000-01-01'])('accepts %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '31-10-2026', '2026-1-1', ''])(
    'rejects %j',
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});

describe('formatDate', () => {
  it('shows DD-MM-YYYY', () => {
    expect(formatDate('2026-10-31')).toBe('31-10-2026');
  });

  it('returns empty text for missing values and leaves unknown text alone', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
    expect(daysBetween('2026-10-14', '2026-10-14')).toBe(0);
  });

  it('is not thrown off by month ends or leap days', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
  });
});

describe('formatDateTime', () => {
  it('renders an instant in IST', () => {
    expect(formatDateTime('2026-10-13T06:10:00Z')).toBe('13-10-2026 11:40');
  });

  it('returns empty text for bad input', () => {
    expect(formatDateTime('nope')).toBe('');
    expect(formatDateTime(null)).toBe('');
  });
});
