import type { ShoppingListItem } from '@opendish/contracts';
import { addQuantities } from './rational.ts';

/**
 * Conservative shopping-list merge (research R9): two lines merge only when
 * the normalized ingredient name matches AND the normalized units are exactly
 * equal, and both sides carry a quantity. Quantities add as exact rationals.
 * Everything else stays as separate lines. Never uses AI.
 */

/** Canonical forms for the small built-in unit synonym set. */
const UNIT_SYNONYMS: Readonly<Record<string, string>> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
};

/** Trim, lowercase, collapse internal whitespace. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalize a unit; null/blank stays null, synonyms map to canonical forms. */
export function normalizeUnit(unit: string | null): string | null {
  if (unit === null) return null;
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === '') return null;
  return UNIT_SYNONYMS[normalized] ?? normalized;
}

function mergeKey(item: ShoppingListItem): string | null {
  if (item.quantity === null) return null;
  return `${normalizeName(item.name)}\x00${normalizeUnit(item.unit) ?? ''}`;
}

/**
 * Fold `incoming` items into `existing`, returning a new list. Merged lines
 * keep the existing line's identity (name, unit, purchased flag) and only
 * gain quantity; non-merging items are appended in order. Pure: neither
 * input list nor its items are mutated.
 */
export function mergeItems(
  existing: ShoppingListItem[],
  incoming: ShoppingListItem[],
): ShoppingListItem[] {
  const result = existing.map((item) => ({ ...item }));
  for (const candidate of incoming) {
    const key = mergeKey(candidate);
    const target =
      key === null ? undefined : result.find((item) => mergeKey(item) === key);
    if (target === undefined) {
      result.push({ ...candidate });
    } else {
      // key !== null guarantees both quantities are set.
      target.quantity = addQuantities(target.quantity!, candidate.quantity!);
    }
  }
  return result;
}
