// Deterministic schema.org JSON-LD Recipe extractor (T030, research R2):
// finds <script type="application/ld+json"> blocks with regex (no DOM
// dependency), handles @graph and array forms, and normalizes the first
// usable Recipe node into a contracts `RecipeDraft`. Imported content is
// untrusted: everything is treated as data and validated against
// `recipeDraftSchema` before being returned.
import {
  makeQuantity,
  recipeDraftSchema,
} from '../../../packages/contracts/src/index.ts';
import type {
  Ingredient,
  Quantity,
  RecipeDraft,
  Step,
} from '../../../packages/contracts/src/index.ts';

export type JsonLdExtractResult =
  | { ok: true; value: RecipeDraft }
  | { ok: false; error: { code: 'no_recipe_found'; message: string } };

type JsonObject = Record<string, unknown>;

const NO_RECIPE = {
  ok: false as const,
  error: {
    code: 'no_recipe_found' as const,
    message: 'No usable schema.org Recipe markup was found on the page.',
  },
};

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    deg: '°',
  };
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = parseInt(entity.slice(2), 16);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      if (entity.startsWith('#')) {
        const code = parseInt(entity.slice(1), 10);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      return named[entity] ?? whole;
    },
  );
}

/** Strips tags, decodes entities, and collapses whitespace. */
function cleanText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeIncludes(node: JsonObject, type: string): boolean {
  const value = node['@type'];
  if (typeof value === 'string') {
    return value.toLowerCase() === type.toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.some(
      (entry) =>
        typeof entry === 'string' &&
        entry.toLowerCase() === type.toLowerCase(),
    );
  }
  return false;
}

/** Recursively collects Recipe nodes from arrays and @graph containers. */
function collectRecipeNodes(value: unknown, out: JsonObject[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecipeNodes(item, out);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (typeIncludes(value, 'Recipe')) {
    out.push(value);
    return;
  }
  if (Array.isArray(value['@graph'])) {
    collectRecipeNodes(value['@graph'], out);
  }
}

function extractJsonLdCandidates(html: string): unknown[] {
  const candidates: unknown[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const typePattern = /type\s*=\s*["']application\/ld\+json["']/i;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) !== null) {
    if (!typePattern.test(match[1])) {
      continue;
    }
    const raw = match[2]
      .replace(/<!--/g, '')
      .replace(/-->/g, '')
      .trim();
    if (raw.length === 0) {
      continue;
    }
    try {
      candidates.push(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD block: skip, other blocks may still parse.
    }
  }
  return candidates;
}

const UNICODE_FRACTIONS: Record<string, [number, number]> = {
  '¼': [1, 4],
  '½': [1, 2],
  '¾': [3, 4],
  '⅐': [1, 7],
  '⅑': [1, 9],
  '⅒': [1, 10],
  '⅓': [1, 3],
  '⅔': [2, 3],
  '⅕': [1, 5],
  '⅖': [2, 5],
  '⅗': [3, 5],
  '⅙': [1, 6],
  '⅚': [5, 6],
  '⅛': [1, 8],
  '⅜': [3, 8],
  '⅝': [5, 8],
  '⅞': [7, 8],
};

const KNOWN_UNITS = new Set([
  'cup',
  'cups',
  'tbsp',
  'tablespoon',
  'tablespoons',
  'tsp',
  'teaspoon',
  'teaspoons',
  'g',
  'gram',
  'grams',
  'kg',
  'kilogram',
  'kilograms',
  'mg',
  'ml',
  'milliliter',
  'milliliters',
  'millilitre',
  'millilitres',
  'l',
  'liter',
  'liters',
  'litre',
  'litres',
  'cl',
  'oz',
  'ounce',
  'ounces',
  'lb',
  'lbs',
  'pound',
  'pounds',
  'pinch',
  'pinches',
  'dash',
  'dashes',
  'can',
  'cans',
  'package',
  'packages',
  'pkg',
  'slice',
  'slices',
  'clove',
  'cloves',
  'stick',
  'sticks',
  'bunch',
  'bunches',
  'sprig',
  'sprigs',
  'piece',
  'pieces',
  'sheet',
  'sheets',
  'head',
  'heads',
  'stalk',
  'stalks',
]);

function tryQuantity(num: number, den: number): Quantity | null {
  try {
    return makeQuantity(num, den);
  } catch {
    return null;
  }
}

function decimalToQuantity(token: string): Quantity | null {
  const match = /^(\d+)[.](\d+)$/.exec(token);
  if (!match) {
    return null;
  }
  const den = 10 ** match[2].length;
  const num = Number(match[1]) * den + Number(match[2]);
  return tryQuantity(num, den);
}

/**
 * Best-effort parse of a leading quantity from an ingredient line.
 * Handles "2", "1/2", "1 1/2", "1½", "½", "1.5", and ranges ("1-2" takes
 * the lower bound). Returns the quantity and how many tokens it consumed.
 */
function parseLeadingQuantity(
  tokens: string[],
): { quantity: Quantity; consumed: number } | null {
  const first = tokens[0];
  const second = tokens[1];

  const fractionParts = /^(\d+)\/(\d+)$/.exec(first);
  if (fractionParts) {
    const quantity = tryQuantity(
      Number(fractionParts[1]),
      Number(fractionParts[2]),
    );
    return quantity ? { quantity, consumed: 1 } : null;
  }
  if (UNICODE_FRACTIONS[first]) {
    const [num, den] = UNICODE_FRACTIONS[first];
    return { quantity: { num, den }, consumed: 1 };
  }
  const attachedMixed = /^(\d+)([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅙⅚⅛⅜⅝⅞])$/.exec(first);
  if (attachedMixed) {
    const whole = Number(attachedMixed[1]);
    const [num, den] = UNICODE_FRACTIONS[attachedMixed[2]];
    const quantity = tryQuantity(whole * den + num, den);
    return quantity ? { quantity, consumed: 1 } : null;
  }
  const decimal = decimalToQuantity(first);
  if (decimal) {
    return { quantity: decimal, consumed: 1 };
  }
  const range = /^(\d+)-(\d+)$/.exec(first);
  if (range) {
    const quantity = tryQuantity(Number(range[1]), 1);
    return quantity ? { quantity, consumed: 1 } : null;
  }
  if (/^\d+$/.test(first)) {
    const whole = Number(first);
    if (second) {
      const secondFraction = /^(\d+)\/(\d+)$/.exec(second);
      if (secondFraction) {
        const den = Number(secondFraction[2]);
        const quantity = tryQuantity(whole * den + Number(secondFraction[1]), den);
        if (quantity) {
          return { quantity, consumed: 2 };
        }
      }
      if (UNICODE_FRACTIONS[second]) {
        const [num, den] = UNICODE_FRACTIONS[second];
        const quantity = tryQuantity(whole * den + num, den);
        if (quantity) {
          return { quantity, consumed: 2 };
        }
      }
    }
    const quantity = tryQuantity(whole, 1);
    return quantity ? { quantity, consumed: 1 } : null;
  }
  return null;
}

/** Parses one recipeIngredient string into a structured Ingredient. */
export function parseIngredient(raw: string): Ingredient {
  const text = cleanText(raw);
  const tokens = text.split(' ').filter((token) => token.length > 0);
  const leading = tokens.length > 0 ? parseLeadingQuantity(tokens) : null;
  if (!leading) {
    return { name: text, quantity: null, unit: null };
  }
  let consumed = leading.consumed;
  let unit: string | null = null;
  const unitCandidate = tokens[consumed]?.toLowerCase().replace(/\.$/, '');
  if (unitCandidate && KNOWN_UNITS.has(unitCandidate)) {
    unit = tokens[consumed].replace(/\.$/, '');
    consumed += 1;
  }
  const name = tokens
    .slice(consumed)
    .join(' ')
    .replace(/^,?\s*of\s+/i, '')
    .trim();
  if (name.length === 0) {
    // Quantity with no name is not a usable parse; keep the raw line.
    return { name: text, quantity: null, unit: null };
  }
  return { name, quantity: leading.quantity, unit };
}

/** Parses an ISO-8601 duration (e.g. PT1H30M, P1DT2H) into minutes. */
export function parseIso8601Duration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      value.trim(),
    );
  if (!match) {
    return null;
  }
  const [, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) {
    return null;
  }
  const total =
    Number(weeks ?? 0) * 7 * 24 * 60 +
    Number(days ?? 0) * 24 * 60 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60;
  return Math.round(total);
}

function parseServings(value: unknown): number {
  if (Array.isArray(value)) {
    return parseServings(value[0]);
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string') {
    const match = /(\d+)/.exec(value);
    if (match) {
      const servings = Number(match[1]);
      if (servings >= 1) {
        return servings;
      }
    }
  }
  return 1;
}

function normalizeInstructions(value: unknown): Step[] {
  const steps: Step[] = [];
  const push = (text: string): void => {
    const cleaned = cleanText(text);
    if (cleaned.length > 0) {
      steps.push({ text: cleaned });
    }
  };
  const walk = (item: unknown): void => {
    if (typeof item === 'string') {
      // A single blob may still contain newline-separated steps.
      for (const line of item.split(/\r?\n/)) {
        push(line);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) {
        walk(entry);
      }
      return;
    }
    if (isObject(item)) {
      if (typeIncludes(item, 'HowToSection')) {
        walk(item.itemListElement);
        return;
      }
      // HowToStep or a bare object: prefer `text`, fall back to `name`.
      push(typeof item.text === 'string' ? item.text : cleanText(item.name));
    }
  };
  walk(value);
  return steps;
}

function parseSourceName(node: JsonObject): string | null {
  const candidates = [node.author, node.publisher, node.sourceOrganization];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const name = cleanText(candidate);
      if (name.length > 0) {
        return name;
      }
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (isObject(entry)) {
          const name = cleanText(entry.name);
          if (name.length > 0) {
            return name;
          }
        }
      }
    }
    if (isObject(candidate)) {
      const name = cleanText(candidate.name);
      if (name.length > 0) {
        return name;
      }
    }
  }
  return null;
}

function parseSourceUrl(node: JsonObject, pageUrl?: string): string | null {
  const candidates: unknown[] = [node.url];
  if (typeof node.mainEntityOfPage === 'string') {
    candidates.push(node.mainEntityOfPage);
  }
  if (isObject(node.mainEntityOfPage)) {
    candidates.push(node.mainEntityOfPage['@id']);
  }
  candidates.push(pageUrl);
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    try {
      return new URL(candidate).toString();
    } catch {
      // Not a valid URL: try the next candidate.
    }
  }
  return null;
}

function parseTags(node: JsonObject): string[] {
  const tags: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const part of value.split(',')) {
        const tag = cleanText(part);
        if (tag.length > 0) {
          tags.push(tag);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        collect(entry);
      }
    }
  };
  collect(node.keywords);
  collect(node.recipeCategory);
  return [...new Set(tags)];
}

function toRecipeDraft(node: JsonObject, pageUrl?: string): RecipeDraft | null {
  const title = cleanText(node.name);
  if (title.length === 0) {
    return null;
  }
  const ingredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient
        .map((entry) => (typeof entry === 'string' ? parseIngredient(entry) : null))
        .filter(
          (entry): entry is Ingredient =>
            entry !== null && entry.name.length > 0,
        )
    : [];
  if (ingredients.length === 0) {
    return null;
  }
  const steps = normalizeInstructions(node.recipeInstructions);
  if (steps.length === 0) {
    return null;
  }
  const description = cleanText(node.description);
  const draft = {
    title,
    description: description.length > 0 ? description : null,
    servings: parseServings(node.recipeYield),
    prepTimeMinutes: parseIso8601Duration(node.prepTime),
    cookTimeMinutes: parseIso8601Duration(node.cookTime),
    sourceName: parseSourceName(node),
    sourceUrl: parseSourceUrl(node, pageUrl),
    ingredients,
    steps,
    tags: parseTags(node),
  };
  const validated = recipeDraftSchema.safeParse(draft);
  return validated.success ? validated.data : null;
}

/**
 * Extracts the first usable schema.org Recipe from an HTML page and
 * normalizes it into a validated `RecipeDraft`.
 */
export function extractRecipeDraftFromHtml(
  html: string,
  pageUrl?: string,
): JsonLdExtractResult {
  const recipes: JsonObject[] = [];
  for (const candidate of extractJsonLdCandidates(html)) {
    collectRecipeNodes(candidate, recipes);
  }
  for (const recipe of recipes) {
    const draft = toRecipeDraft(recipe, pageUrl);
    if (draft) {
      return { ok: true, value: draft };
    }
  }
  return NO_RECIPE;
}
