import { makeQuantity, type Quantity } from '@opendish/contracts';

/**
 * Exact rational arithmetic over the contracts `Quantity` type (research R3).
 * All results are reduced positive rationals constructed via `makeQuantity`,
 * so the contracts invariant (num/den positive integers, lowest terms) holds.
 */

/** Sum of two exact quantities, reduced. */
export function addQuantities(a: Quantity, b: Quantity): Quantity {
  return makeQuantity(a.num * b.den + b.num * a.den, a.den * b.den);
}

/** Product of a quantity and a rational factor, reduced. */
export function multiplyQuantity(value: Quantity, factor: Quantity): Quantity {
  return makeQuantity(value.num * factor.num, value.den * factor.den);
}

/** Reduce an arbitrary integer fraction to a contracts `Quantity`. */
export function reduceQuantity(num: number, den: number): Quantity {
  return makeQuantity(num, den);
}

/**
 * Total order over quantities: negative when a < b, 0 when equal, positive
 * when a > b. Cross-multiplication keeps this exact.
 */
export function compareQuantities(a: Quantity, b: Quantity): number {
  const diff = a.num * b.den - b.num * a.den;
  return diff === 0 ? 0 : diff < 0 ? -1 : 1;
}

/** Unicode vulgar fractions for the common kitchen denominators 2/3/4/6/8. */
const VULGAR_FRACTIONS: Readonly<Record<string, string>> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};

const VULGAR_TO_FRACTION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(VULGAR_FRACTIONS).map(([fraction, glyph]) => [
    glyph,
    fraction,
  ]),
);

function formatDecimal(num: number, den: number): string {
  const rounded = Math.round((num / den) * 100) / 100;
  return String(rounded);
}

function parseVulgarFraction(input: string): Quantity | null {
  const fraction = VULGAR_TO_FRACTION[input.trim()];
  if (fraction === undefined) return null;
  const [num, den] = fraction.split('/').map(Number);
  return makeQuantity(num, den);
}

function parseDecimalFraction(input: string): Quantity | null {
  const match = /^\d+\.\d+$/.exec(input.trim());
  if (match === null) return null;
  const [whole, decimal] = input.trim().split('.');
  const den = 10 ** decimal.length;
  const num = Number(`${whole}${decimal}`);
  return makeQuantity(num, den);
}

function parseSlashFraction(input: string): Quantity | null {
  const match = /^\d+\/\d+$/.exec(input.trim());
  if (match === null) return null;
  const [num, den] = input.trim().split('/').map(Number);
  return makeQuantity(num, den);
}

/**
 * Parse a human-entered quantity into a reduced positive rational.
 *
 * Accepts:
 * - whole numbers: "2", "12"
 * - decimals: "1.5", "0.75"
 * - slash fractions: "1/2", "3/4"
 * - mixed numbers: "1 1/2", "1 ½"
 * - Unicode vulgar fractions: "½", "¾"
 *
 * Returns `null` for blank or unparseable input. Throws (via `makeQuantity`)
 * for zero or negative denominators.
 */
export function parseQuantityInput(input: string): Quantity | null {
  const normalized = input.trim();
  if (normalized === '') return null;

  // Whole number
  if (/^\d+$/.test(normalized)) {
    return makeQuantity(Number(normalized), 1);
  }

  // Unicode vulgar fraction by itself
  const vulgar = parseVulgarFraction(normalized);
  if (vulgar !== null) return vulgar;

  // Decimal
  const decimal = parseDecimalFraction(normalized);
  if (decimal !== null) return decimal;

  // Slash fraction
  const slash = parseSlashFraction(normalized);
  if (slash !== null) return slash;

  // Mixed number: whole + fraction (slash or vulgar)
  const mixedMatch = /^(\d+)\s+(.+)$/.exec(normalized);
  if (mixedMatch !== null) {
    const whole = Number(mixedMatch[1]);
    const fractionPart = mixedMatch[2];
    const fraction =
      parseSlashFraction(fractionPart) ?? parseVulgarFraction(fractionPart);
    if (fraction !== null) {
      return makeQuantity(whole * fraction.den + fraction.num, fraction.den);
    }
  }

  return null;
}

/**
 * Human display for a quantity: mixed numbers with Unicode vulgar fractions
 * for common denominators (3/2 -> "1 ½"), a trimmed 2-decimal fallback for
 * awkward ones (1/7 -> "0.14"), "0" for zero. Accepts any non-negative
 * num / positive den pair; the value is reduced before formatting.
 */
export function formatQuantity(value: { num: number; den: number }): string {
  const { num, den } = value;
  if (num === 0) return '0';
  if (den <= 0 || !Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error(`cannot format invalid quantity ${num}/${den}`);
  }
  const reduced = makeQuantity(num, den);
  const whole = Math.floor(reduced.num / reduced.den);
  const remainder = reduced.num % reduced.den;
  if (remainder === 0) return String(whole);
  const fraction = VULGAR_FRACTIONS[`${remainder}/${reduced.den}`];
  if (fraction === undefined) {
    return formatDecimal(reduced.num, reduced.den);
  }
  return whole === 0 ? fraction : `${whole} ${fraction}`;
}
