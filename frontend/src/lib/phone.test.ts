import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from '@/lib/phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['(+91) 9876543210', '+919876543210'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12345', '98765432101', 'abcdefghij', '+1 9876543210', '98765 4321'])(
    'rejects %s',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('formatPhone', () => {
  it('groups a stored number', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
  });
  it('handles empty and unknown shapes', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('12345')).toBe('12345');
  });
});
