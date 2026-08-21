import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractRecipeDraftFromHtml,
  parseIngredient,
  parseIso8601Duration,
} from '../_shared/jsonld-recipe.ts';
import { makeQuantity } from '../../../packages/contracts/src/index.ts';

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, 'fixtures', name),
    'utf-8',
  );
}

describe('parseIso8601Duration', () => {
  it.each([
    ['PT1H30M', 90],
    ['PT2H', 120],
    ['PT45M', 45],
    ['P1DT2H', 1560],
    ['PT30S', 1],
    ['PT90S', 2],
    [15, 15],
    ['not a duration', null],
  ])('parses %p as %p minutes', (input, expected) => {
    expect(parseIso8601Duration(input)).toBe(expected);
  });
});

describe('parseIngredient', () => {
  it.each([
    {
      raw: '1 1/2 cups all-purpose flour',
      name: 'all-purpose flour',
      quantity: makeQuantity(3, 2),
      unit: 'cups',
    },
    {
      raw: '2 tbsp sugar',
      name: 'sugar',
      quantity: makeQuantity(2, 1),
      unit: 'tbsp',
    },
    {
      raw: '1 tsp baking powder',
      name: 'baking powder',
      quantity: makeQuantity(1, 1),
      unit: 'tsp',
    },
    {
      raw: '1¼ cups milk',
      name: 'milk',
      quantity: makeQuantity(5, 4),
      unit: 'cups',
    },
    {
      raw: 'salt',
      name: 'salt',
      quantity: null,
      unit: null,
    },
    {
      raw: '1-2 cloves garlic',
      name: 'garlic',
      quantity: makeQuantity(1, 1),
      unit: 'cloves',
    },
  ])('parses "$raw"', ({ raw, name, quantity, unit }) => {
    const parsed = parseIngredient(raw);
    expect(parsed.name).toBe(name);
    expect(parsed.quantity).toEqual(quantity);
    expect(parsed.unit).toBe(unit);
  });
});

describe('extractRecipeDraftFromHtml', () => {
  it('extracts a Recipe nested in @graph form', () => {
    const result = extractRecipeDraftFromHtml(
      fixture('jsonld-graph.html'),
      'https://example.com/graph-pancakes',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft = result.value;
    expect(draft.title).toBe('Schema Graph Pancakes');
    expect(draft.description).toBe('Fluffy pancakes from a @graph block.');
    expect(draft.servings).toBe(4);
    expect(draft.prepTimeMinutes).toBe(10);
    expect(draft.cookTimeMinutes).toBe(15);
    expect(draft.sourceName).toBe('Graph Chef');
    expect(draft.sourceUrl).toBe('https://example.com/graph-pancakes');
    expect(draft.tags).toEqual(['breakfast', 'pancakes']);
    expect(draft.ingredients).toHaveLength(4);
    expect(draft.ingredients[0]).toEqual({
      name: 'all-purpose flour',
      quantity: makeQuantity(3, 2),
      unit: 'cups',
    });
    expect(draft.steps).toHaveLength(3);
    expect(draft.steps[0].text).toBe('Whisk dry ingredients together.');
  });

  it('extracts a Recipe with HowToSection instructions', () => {
    const result = extractRecipeDraftFromHtml(
      fixture('jsonld-howto.html'),
      'https://example.com/howto-soup',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft = result.value;
    expect(draft.title).toBe('HowToSection Soup');
    expect(draft.servings).toBe(6);
    expect(draft.prepTimeMinutes).toBe(15);
    expect(draft.cookTimeMinutes).toBe(30);
    expect(draft.sourceName).toBe('Soup Co.');
    expect(draft.sourceUrl).toBe('https://example.com/howto-soup');
    expect(draft.tags).toEqual(['soup', 'vegetarian']);
    expect(draft.ingredients).toHaveLength(4);
    expect(draft.ingredients[0]).toEqual({
      name: 'potatoes',
      quantity: makeQuantity(2, 1),
      unit: 'lbs',
    });
    expect(draft.steps).toHaveLength(4);
    expect(draft.steps[0].text).toBe('Peel and chop the potatoes.');
    expect(draft.steps[3].text).toBe('Blend until smooth and season with salt.');
  });

  it('returns no_recipe_found for pages without recipe markup', () => {
    const result = extractRecipeDraftFromHtml(
      fixture('jsonld-no-recipe.html'),
      'https://example.com/about',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no_recipe_found');
    }
  });

  it('falls back to mainEntityOfPage and page URL for sourceUrl', () => {
    const html = `<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "URL Fallback Recipe",
        "mainEntityOfPage": "https://example.com/fallback",
        "recipeIngredient": ["1 cup rice"],
        "recipeInstructions": [{"@type": "HowToStep", "text": "Cook."}]
      }
    </script>
  </head>
</html>`;
    const result = extractRecipeDraftFromHtml(html, 'https://example.com/page');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceUrl).toBe('https://example.com/fallback');
  });

  it('skips malformed JSON-LD blocks and still finds a recipe', () => {
    const html = `<!doctype html>
<html>
  <head>
    <script type="application/ld+json">not json</script>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Skipped Malformed Recipe",
        "recipeIngredient": ["1 cup water"],
        "recipeInstructions": [{"@type": "HowToStep", "text": "Boil."}]
      }
    </script>
  </head>
</html>`;
    const result = extractRecipeDraftFromHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Skipped Malformed Recipe');
  });
});
