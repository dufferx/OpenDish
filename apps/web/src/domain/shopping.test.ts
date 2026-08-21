import { describe, expect, it } from 'vitest';
import { makeQuantity, type ShoppingListItem } from '@opendish/contracts';
import { mergeItems, normalizeName, normalizeUnit } from './shopping.ts';

function item(
  name: string,
  quantity: { num: number; den: number } | null,
  unit: string | null,
  isPurchased = false,
): ShoppingListItem {
  return {
    name,
    quantity:
      quantity === null ? null : makeQuantity(quantity.num, quantity.den),
    unit,
    isPurchased,
  };
}

describe('normalizeName', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeName('  Brown   Sugar ')).toBe('brown sugar');
    expect(normalizeName('FLOUR')).toBe('flour');
    expect(normalizeName('olive\t oil')).toBe('olive oil');
  });
});

describe('normalizeUnit', () => {
  it('maps synonyms to canonical units', () => {
    expect(normalizeUnit('g')).toBe('g');
    expect(normalizeUnit('gram')).toBe('g');
    expect(normalizeUnit('Grams')).toBe('g');
    expect(normalizeUnit('ml')).toBe('ml');
    expect(normalizeUnit('milliliter')).toBe('ml');
    expect(normalizeUnit('milliliters')).toBe('ml');
    expect(normalizeUnit('l')).toBe('l');
    expect(normalizeUnit('Liter')).toBe('l');
    expect(normalizeUnit('liters')).toBe('l');
    expect(normalizeUnit('tbsp')).toBe('tbsp');
    expect(normalizeUnit('tablespoon')).toBe('tbsp');
    expect(normalizeUnit('Tablespoons')).toBe('tbsp');
    expect(normalizeUnit('tsp')).toBe('tsp');
    expect(normalizeUnit('teaspoon')).toBe('tsp');
    expect(normalizeUnit('teaspoons')).toBe('tsp');
  });

  it('keeps unknown units (normalized) as-is', () => {
    expect(normalizeUnit(' Cups ')).toBe('cups');
    expect(normalizeUnit('kg')).toBe('kg');
  });

  it('treats null and blank as no unit', () => {
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit('   ')).toBeNull();
  });
});

describe('mergeItems', () => {
  it('merges same normalized name and unit, adding quantities as rationals', () => {
    const merged = mergeItems(
      [item(' Flour ', { num: 1, den: 2 }, 'g')],
      [item('flour', { num: 3, den: 4 }, 'grams')],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toEqual(makeQuantity(5, 4));
  });

  it('merges across unit synonyms (tbsp/tablespoons, ml/milliliters, l/liter, tsp/teaspoon)', () => {
    const merged = mergeItems(
      [
        item('Olive oil', { num: 1, den: 1 }, 'tablespoons'),
        item('Milk', { num: 1, den: 2 }, 'ml'),
        item('Water', { num: 1, den: 1 }, 'liter'),
        item('Salt', { num: 1, den: 4 }, 'tsp'),
      ],
      [
        item('olive oil', { num: 2, den: 1 }, 'tbsp'),
        item('milk', { num: 1, den: 2 }, 'milliliters'),
        item('water', { num: 1, den: 1 }, 'l'),
        item('salt', { num: 1, den: 4 }, 'teaspoon'),
      ],
    );
    expect(merged.map((i) => i.quantity)).toEqual([
      makeQuantity(3, 1),
      makeQuantity(1, 1),
      makeQuantity(2, 1),
      makeQuantity(1, 2),
    ]);
  });

  it('keeps items with different units separate', () => {
    const merged = mergeItems(
      [item('Flour', { num: 1, den: 1 }, 'g')],
      [
        item('flour', { num: 1, den: 1 }, 'kg'),
        item('flour', { num: 2, den: 1 }, null),
      ],
    );
    expect(merged).toHaveLength(3);
  });

  it('keeps items separate when either side is quantity-less', () => {
    const merged = mergeItems(
      [item('Salt', null, null), item('Pepper', { num: 1, den: 2 }, 'tsp')],
      [item('salt', null, null), item('pepper', null, 'tsp')],
    );
    expect(merged).toHaveLength(4);
  });

  it('keeps different names separate even with equal units', () => {
    const merged = mergeItems(
      [item('White sugar', { num: 1, den: 1 }, 'g')],
      [item('Brown sugar', { num: 1, den: 1 }, 'g')],
    );
    expect(merged).toHaveLength(2);
  });

  it('merges multiple incoming items into one existing line cumulatively', () => {
    const merged = mergeItems(
      [item('Eggs', { num: 1, den: 1 }, null)],
      [
        item('eggs', { num: 2, den: 1 }, null),
        item('EGGS', { num: 1, den: 2 }, null),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toEqual(makeQuantity(7, 2));
  });

  it('merges within the incoming batch itself', () => {
    const merged = mergeItems(
      [],
      [
        item('Butter', { num: 1, den: 4 }, 'g'),
        item('butter', { num: 1, den: 4 }, 'grams'),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toEqual(makeQuantity(1, 2));
  });

  it('preserves the existing line identity (name, unit, purchased flag) on merge', () => {
    const merged = mergeItems(
      [item('Flour', { num: 1, den: 2 }, 'g', true)],
      [item('FLOUR', { num: 1, den: 2 }, 'grams')],
    );
    expect(merged[0].name).toBe('Flour');
    expect(merged[0].unit).toBe('g');
    expect(merged[0].isPurchased).toBe(true);
  });

  it('appends non-merging incoming items after existing ones', () => {
    const merged = mergeItems(
      [item('Flour', { num: 1, den: 1 }, 'g')],
      [item('Sugar', { num: 1, den: 1 }, 'g')],
    );
    expect(merged.map((i) => i.name)).toEqual(['Flour', 'Sugar']);
  });

  it('does not mutate the input lists or items', () => {
    const existing = [item('Flour', { num: 1, den: 2 }, 'g')];
    const incoming = [item('flour', { num: 1, den: 2 }, 'g')];
    const existingBefore = structuredClone(existing);
    const incomingBefore = structuredClone(incoming);
    const merged = mergeItems(existing, incoming);
    expect(existing).toEqual(existingBefore);
    expect(incoming).toEqual(incomingBefore);
    expect(merged).not.toBe(existing);
    expect(merged[0]).not.toBe(existing[0]);
  });

  it('handles empty inputs', () => {
    expect(mergeItems([], [])).toEqual([]);
    const existing = [item('Flour', { num: 1, den: 1 }, 'g')];
    expect(mergeItems(existing, [])).toEqual(existing);
  });
});
