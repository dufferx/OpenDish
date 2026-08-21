import { describe, expect, it } from 'vitest';
import { makeQuantity } from '@opendish/contracts';
import {
  addQuantities,
  compareQuantities,
  formatQuantity,
  multiplyQuantity,
  parseQuantityInput,
  reduceQuantity,
} from './rational.ts';

describe('addQuantities', () => {
  it('adds fractions with different denominators', () => {
    expect(addQuantities(makeQuantity(1, 2), makeQuantity(1, 3))).toEqual(
      makeQuantity(5, 6),
    );
  });

  it('reduces the result', () => {
    expect(addQuantities(makeQuantity(1, 2), makeQuantity(1, 2))).toEqual(
      makeQuantity(1, 1),
    );
    expect(addQuantities(makeQuantity(1, 4), makeQuantity(1, 4))).toEqual(
      makeQuantity(1, 2),
    );
  });

  it('adds whole quantities', () => {
    expect(addQuantities(makeQuantity(2, 1), makeQuantity(3, 1))).toEqual(
      makeQuantity(5, 1),
    );
  });
});

describe('multiplyQuantity', () => {
  it('multiplies by a rational factor and reduces', () => {
    expect(multiplyQuantity(makeQuantity(2, 3), makeQuantity(3, 4))).toEqual(
      makeQuantity(1, 2),
    );
  });

  it('scales up past whole numbers', () => {
    expect(multiplyQuantity(makeQuantity(3, 2), makeQuantity(4, 3))).toEqual(
      makeQuantity(2, 1),
    );
  });

  it('multiplies by a whole-number factor', () => {
    expect(multiplyQuantity(makeQuantity(1, 8), makeQuantity(4, 1))).toEqual(
      makeQuantity(1, 2),
    );
  });
});

describe('reduceQuantity', () => {
  it('reduces to lowest terms via makeQuantity', () => {
    expect(reduceQuantity(4, 6)).toEqual(makeQuantity(2, 3));
    expect(reduceQuantity(10, 5)).toEqual(makeQuantity(2, 1));
    expect(reduceQuantity(7, 13)).toEqual(makeQuantity(7, 13));
  });

  it('rejects non-positive or non-integer input', () => {
    expect(() => reduceQuantity(0, 2)).toThrow();
    expect(() => reduceQuantity(1, 0)).toThrow();
    expect(() => reduceQuantity(1.5, 2)).toThrow();
  });
});

describe('compareQuantities', () => {
  it('orders fractions across denominators', () => {
    expect(
      compareQuantities(makeQuantity(1, 2), makeQuantity(2, 3)),
    ).toBeLessThan(0);
    expect(
      compareQuantities(makeQuantity(2, 3), makeQuantity(1, 2)),
    ).toBeGreaterThan(0);
  });

  it('returns 0 for equal values in different terms', () => {
    expect(compareQuantities(makeQuantity(1, 2), makeQuantity(1, 2))).toBe(0);
    expect(compareQuantities(makeQuantity(2, 1), makeQuantity(2, 1))).toBe(0);
  });
});

describe('formatQuantity', () => {
  it('formats whole numbers plainly', () => {
    expect(formatQuantity({ num: 2, den: 1 })).toBe('2');
    expect(formatQuantity({ num: 10, den: 5 })).toBe('2');
  });

  it('formats zero', () => {
    expect(formatQuantity({ num: 0, den: 1 })).toBe('0');
  });

  it('formats proper fractions with Unicode vulgar fractions', () => {
    expect(formatQuantity({ num: 1, den: 2 })).toBe('½');
    expect(formatQuantity({ num: 1, den: 3 })).toBe('⅓');
    expect(formatQuantity({ num: 2, den: 3 })).toBe('⅔');
    expect(formatQuantity({ num: 1, den: 4 })).toBe('¼');
    expect(formatQuantity({ num: 3, den: 4 })).toBe('¾');
    expect(formatQuantity({ num: 1, den: 6 })).toBe('⅙');
    expect(formatQuantity({ num: 5, den: 6 })).toBe('⅚');
    expect(formatQuantity({ num: 1, den: 8 })).toBe('⅛');
    expect(formatQuantity({ num: 3, den: 8 })).toBe('⅜');
    expect(formatQuantity({ num: 5, den: 8 })).toBe('⅝');
    expect(formatQuantity({ num: 7, den: 8 })).toBe('⅞');
  });

  it('formats improper fractions as mixed numbers', () => {
    expect(formatQuantity({ num: 3, den: 2 })).toBe('1 ½');
    expect(formatQuantity({ num: 5, den: 4 })).toBe('1 ¼');
    expect(formatQuantity({ num: 11, den: 8 })).toBe('1 ⅜');
    expect(formatQuantity({ num: 7, den: 3 })).toBe('2 ⅓');
    expect(formatQuantity({ num: 13, den: 6 })).toBe('2 ⅙');
  });

  it('reduces before formatting', () => {
    expect(formatQuantity({ num: 2, den: 4 })).toBe('½');
    expect(formatQuantity({ num: 6, den: 8 })).toBe('¾');
    expect(formatQuantity({ num: 6, den: 4 })).toBe('1 ½');
  });

  it('falls back to trimmed decimals (max 2) for awkward denominators', () => {
    expect(formatQuantity({ num: 1, den: 7 })).toBe('0.14');
    expect(formatQuantity({ num: 10, den: 7 })).toBe('1.43');
    expect(formatQuantity({ num: 1, den: 5 })).toBe('0.2');
    expect(formatQuantity({ num: 3, den: 5 })).toBe('0.6');
    expect(formatQuantity({ num: 7, den: 5 })).toBe('1.4');
    expect(formatQuantity({ num: 1, den: 10 })).toBe('0.1');
    expect(formatQuantity({ num: 2, den: 7 })).toBe('0.29');
    expect(formatQuantity({ num: 5, den: 9 })).toBe('0.56');
  });
});

describe('parseQuantityInput', () => {
  it('parses whole numbers', () => {
    expect(parseQuantityInput('2')).toEqual(makeQuantity(2, 1));
    expect(parseQuantityInput('  12  ')).toEqual(makeQuantity(12, 1));
  });

  it('parses decimals', () => {
    expect(parseQuantityInput('1.5')).toEqual(makeQuantity(3, 2));
    expect(parseQuantityInput('0.75')).toEqual(makeQuantity(3, 4));
    expect(parseQuantityInput('2.0')).toEqual(makeQuantity(2, 1));
  });

  it('parses slash fractions', () => {
    expect(parseQuantityInput('1/2')).toEqual(makeQuantity(1, 2));
    expect(parseQuantityInput('3/4')).toEqual(makeQuantity(3, 4));
  });

  it('parses Unicode vulgar fractions', () => {
    expect(parseQuantityInput('½')).toEqual(makeQuantity(1, 2));
    expect(parseQuantityInput('¾')).toEqual(makeQuantity(3, 4));
  });

  it('parses mixed numbers with slash or vulgar fractions', () => {
    expect(parseQuantityInput('1 1/2')).toEqual(makeQuantity(3, 2));
    expect(parseQuantityInput('1 ½')).toEqual(makeQuantity(3, 2));
    expect(parseQuantityInput('2 3/4')).toEqual(makeQuantity(11, 4));
  });

  it('returns null for blank or unparseable input', () => {
    expect(parseQuantityInput('')).toBeNull();
    expect(parseQuantityInput('   ')).toBeNull();
    expect(parseQuantityInput('abc')).toBeNull();
    expect(parseQuantityInput('1/2/3')).toBeNull();
  });

  it('rejects zero and treats negatives as unparseable', () => {
    expect(() => parseQuantityInput('0')).toThrow();
    expect(parseQuantityInput('-1')).toBeNull();
    expect(parseQuantityInput('-1/2')).toBeNull();
  });
});
