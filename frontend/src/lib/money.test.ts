import { describe, expect, it } from 'vitest';
import {
  formatPaise,
  groupIndian,
  isValidRupeeString,
  MAX_PAISE,
  paiseToRupeeString,
  rupeeStringToPaise,
} from './money';

describe('rupeeStringToPaise', () => {
  it.each([
    ['0.1', 10],
    ['12500', 1_250_000],
    ['12500.5', 1_250_050],
    ['12500.50', 1_250_050],
    ['0.01', 1],
    ['0', 0],
    ['999999999999.99', 99_999_999_999_999],
  ])('converts %s to %d paise exactly', (input, expected) => {
    expect(rupeeStringToPaise(input)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '1e3',
    '1E3',
    '-1',
    '+1',
    '1.234',
    '0.105',
    '12,5',
    '1,25,000',
    '1.',
    '.5',
    'abc',
    '1 000',
  ])('rejects %j', (input) => {
    expect(rupeeStringToPaise(input)).toBeNull();
    expect(isValidRupeeString(input)).toBe(false);
  });

  it('rejects amounts of more than 12 rupee digits', () => {
    expect(rupeeStringToPaise('1000000000000')).toBeNull();
  });

  it('never exceeds the documented maximum', () => {
    expect(MAX_PAISE).toBe(99_999_999_999_999);
    expect(Number.isSafeInteger(MAX_PAISE)).toBe(true);
  });

  it('is exact where binary floating point is not', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in paise it is exactly 30.
    const total = (rupeeStringToPaise('0.1') ?? 0) + (rupeeStringToPaise('0.2') ?? 0);
    expect(total).toBe(30);
  });
});

describe('formatPaise', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [100, '₹1.00'],
    [99_900, '₹999.00'],
    [100_000, '₹1,000.00'],
    [1_250_050, '₹12,500.50'],
    [12_500_000, '₹1,25,000.00'],
    [98_765_432_100, '₹98,76,54,321.00'],
  ])('formats %d paise as %s', (paise, expected) => {
    expect(formatPaise(paise)).toBe(expected);
  });

  it('formats negatives with a leading minus', () => {
    expect(formatPaise(-150)).toBe('-₹1.50');
  });
});

describe('groupIndian', () => {
  it.each([
    ['1', '1'],
    ['999', '999'],
    ['1234', '1,234'],
    ['123456', '1,23,456'],
    ['12345678', '1,23,45,678'],
    ['1234567890', '1,23,45,67,890'],
  ])('groups %s as %s', (digits, expected) => {
    expect(groupIndian(digits)).toBe(expected);
  });
});

describe('paiseToRupeeString', () => {
  it('round-trips with rupeeStringToPaise', () => {
    for (const paise of [1, 10, 99, 100, 12_345, 1_250_050]) {
      expect(rupeeStringToPaise(paiseToRupeeString(paise))).toBe(paise);
    }
  });

  it('pads paise to two digits', () => {
    expect(paiseToRupeeString(1_250_005)).toBe('12500.05');
  });
});
