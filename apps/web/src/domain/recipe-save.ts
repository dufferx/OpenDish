import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  makeQuantity,
  nutritionRecordSchema,
  recipeDraftSchema,
  recipeSnapshotSchema,
  type NutritionRecord,
  type RecipeSnapshot,
} from '@opendish/contracts';

/**
 * The single recipe save path (research R6, data-model "Domain invariants").
 * EVERY intentional recipe write — manual edit, AI-applied proposal, saved
 * serving adjustment, restore, variant creation — goes through `saveRecipe`,
 * which validates the draft against `recipeDraftSchema`, snapshots the
 * previous state into `recipe_history` (version = current head_version,
 * tagged with change_kind) and increments head_version. Ordinary creates
 * start at head_version 1 with no history; variant creation additionally
 * writes an initial version-1 snapshot then advances the live row to
 * head_version 2 so the first independent edit can snapshot version 2
 * without colliding on the unique (recipe_id, version) invariant. Restore
 * funnels back through the same path with kind 'restore'.
 *
 * DB access sits behind the minimal `RecipeStore` interface so the domain
 * logic is unit-testable; `createSupabaseRecipeStore` adapts a real client.
 */

export const changeKindSchema = z.enum([
  'manual_edit',
  'ai_applied',
  'serving_adjustment',
  'restore',
  'variant_created',
]);
export type ChangeKind = z.infer<typeof changeKindSchema>;

export const saveRecipeInputSchema = recipeDraftSchema
  .extend({
    /** null = create; otherwise the recipe to update. */
    recipeId: z.string().uuid().nullable(),
    changeKind: changeKindSchema,
    /** Owner id; required on create, ignored on update (owner comes from the row). */
    userId: z.string().uuid().nullable().default(null),
    /** Storage object path; omitted on update keeps the current value. */
    imagePath: z.string().nullable().optional(),
    /** Source recipe for a saved variant; updates preserve the stored link. */
    sourceRecipeId: z.string().uuid().nullable().default(null),
    origin: z.enum(['manual', 'imported', 'ai_generated']).default('manual'),
    isFavorite: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.recipeId === null && value.userId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'userId is required when creating a recipe',
      });
    }
  });
export type SaveRecipeInput = z.input<typeof saveRecipeInputSchema>;

export interface SaveRecipeResult {
  recipeId: string;
  headVersion: number;
}

export class RecipeValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(
      `recipe save input failed validation: ${error.issues[0]?.message ?? 'invalid'}`,
    );
    this.name = 'RecipeValidationError';
    this.issues = error.issues;
  }
}

export class RecipeNotFoundError extends Error {
  readonly recipeId: string;

  constructor(recipeId: string) {
    super(`recipe not found: ${recipeId}`);
    this.name = 'RecipeNotFoundError';
    this.recipeId = recipeId;
  }
}

export class HistoryEntryNotFoundError extends Error {
  readonly recipeId: string;
  readonly historyId: string;

  constructor(recipeId: string, historyId: string) {
    super(`history entry ${historyId} not found for recipe ${recipeId}`);
    this.name = 'HistoryEntryNotFoundError';
    this.recipeId = recipeId;
    this.historyId = historyId;
  }
}

/** head_version moved between read and write — a concurrent save happened. */
export class RecipeConcurrencyError extends Error {
  readonly recipeId: string;

  constructor(recipeId: string) {
    super(`recipe ${recipeId} was modified concurrently; reload and retry`);
    this.name = 'RecipeConcurrencyError';
    this.recipeId = recipeId;
  }
}

// --- RecipeStore: the minimal typed DB surface -----------------------------

export interface StoredRecipeRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  imagePath: string | null;
  sourceRecipeId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  isFavorite: boolean;
  headVersion: number;
  origin: string;
  nutrition?: NutritionRecord | null;
}

export interface StoredIngredientRow {
  position: number;
  name: string;
  quantityNum: number | null;
  quantityDen: number | null;
  unit: string | null;
  nutritionFoodId?: string | null;
  userProductId?: string | null;
}

export interface StoredStepRow {
  position: number;
  text: string;
}

export interface StoredRecipeState {
  recipe: StoredRecipeRow;
  ingredients: StoredIngredientRow[];
  steps: StoredStepRow[];
  tags: string[];
}

export interface StoredHistoryEntry {
  id: string;
  version: number;
  changeKind: string;
  snapshot: unknown;
}

export type NewRecipeFields = Omit<StoredRecipeRow, 'id' | 'headVersion'>;
export type UpdatedRecipeFields = Omit<NewRecipeFields, 'userId'>;

export interface RecipeStore {
  /** Full current state (row + ordered ingredients/steps + tags); null if missing. */
  getRecipeState(recipeId: string): Promise<StoredRecipeState | null>;
  insertHistory(entry: {
    recipeId: string;
    version: number;
    snapshot: RecipeSnapshot;
    changeKind: ChangeKind;
  }): Promise<void>;
  /** Insert the recipes row (head_version starts at 1); returns the new id. */
  createRecipe(fields: NewRecipeFields): Promise<string>;
  /**
   * Update the recipes row, guarded by `expectedHeadVersion`
   * (optimistic concurrency); must throw `RecipeConcurrencyError` on mismatch.
   */
  updateRecipe(
    recipeId: string,
    expectedHeadVersion: number,
    fields: UpdatedRecipeFields,
    nextHeadVersion: number,
  ): Promise<void>;
  /** Delete + reinsert the recipe's ingredients with their positions. */
  replaceIngredients(
    recipeId: string,
    rows: StoredIngredientRow[],
  ): Promise<void>;
  /** Delete + reinsert the recipe's steps with their positions. */
  replaceSteps(recipeId: string, rows: StoredStepRow[]): Promise<void>;
  /** Upsert tag rows for the user and replace the recipe's tag links. */
  syncTags(recipeId: string, userId: string, tagNames: string[]): Promise<void>;
  getHistoryEntry(
    recipeId: string,
    historyId: string,
  ): Promise<StoredHistoryEntry | null>;
}

// --- domain logic ------------------------------------------------------------

function toIngredientRows(
  ingredients: SaveRecipeInput['ingredients'],
): StoredIngredientRow[] {
  return ingredients.map((ingredient, position) => {
    const source = ingredient.nutritionSource;
    return {
      position,
      name: ingredient.name,
      quantityNum: ingredient.quantity?.num ?? null,
      quantityDen: ingredient.quantity?.den ?? null,
      unit: ingredient.unit,
      ...(source?.sourceType === 'generic_food'
        ? { nutritionFoodId: source.sourceId }
        : source?.sourceType === 'user_product'
          ? { userProductId: source.sourceId }
          : {}),
    };
  });
}

function toStepRows(steps: SaveRecipeInput['steps']): StoredStepRow[] {
  return steps.map((step, position) => ({ position, text: step.text }));
}

function byPosition<T extends { position: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

/** Build (and validate) the immutable snapshot of a stored state. */
function buildSnapshot(state: StoredRecipeState): RecipeSnapshot {
  const { recipe } = state;
  return recipeSnapshotSchema.parse({
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
    ingredients: byPosition(state.ingredients).map((row) => ({
      name: row.name,
      quantity:
        row.quantityNum === null
          ? null
          : makeQuantity(row.quantityNum, row.quantityDen ?? 1),
      unit: row.unit,
      nutritionSource:
        row.nutritionFoodId != null
          ? { sourceType: 'generic_food', sourceId: row.nutritionFoodId }
          : row.userProductId != null
            ? { sourceType: 'user_product', sourceId: row.userProductId }
            : null,
    })),
    steps: byPosition(state.steps).map((row) => ({ text: row.text })),
    tags: state.tags,
    imagePath: recipe.imagePath,
    nutrition: recipe.nutrition,
  });
}

function parseInput(input: SaveRecipeInput) {
  const parsed = saveRecipeInputSchema.safeParse(input);
  if (!parsed.success) throw new RecipeValidationError(parsed.error);
  return parsed.data;
}

/** Save path over an arbitrary `RecipeStore` (unit-testable core). */
export async function saveRecipeWithStore(
  store: RecipeStore,
  input: SaveRecipeInput,
): Promise<SaveRecipeResult> {
  const {
    recipeId,
    changeKind,
    userId,
    imagePath,
    sourceRecipeId,
    origin,
    isFavorite,
    ...draft
  } = parseInput(input);

  if (recipeId === null) {
    const createFields = {
      ...draft,
      userId: userId!,
      imagePath: imagePath ?? null,
      sourceRecipeId,
      origin,
      isFavorite,
    };
    const newId = await store.createRecipe({
      ...createFields,
    });
    await store.replaceIngredients(newId, toIngredientRows(draft.ingredients));
    await store.replaceSteps(newId, toStepRows(draft.steps));
    await store.syncTags(newId, userId!, draft.tags);
    if (changeKind === 'variant_created') {
      const created = await store.getRecipeState(newId);
      if (created === null) throw new RecipeNotFoundError(newId);
      await store.insertHistory({
        recipeId: newId,
        version: 1,
        snapshot: buildSnapshot(created),
        changeKind,
      });
      await store.updateRecipe(
        newId,
        1,
        {
          ...draft,
          imagePath: imagePath ?? null,
          sourceRecipeId,
          origin,
          isFavorite,
        },
        2,
      );
      return { recipeId: newId, headVersion: 2 };
    }
    return { recipeId: newId, headVersion: 1 };
  }

  const current = await store.getRecipeState(recipeId);
  if (current === null) throw new RecipeNotFoundError(recipeId);

  // Every update snapshots the PREVIOUS state at the CURRENT head_version.
  await store.insertHistory({
    recipeId,
    version: current.recipe.headVersion,
    snapshot: buildSnapshot(current),
    changeKind,
  });

  const nextHeadVersion = current.recipe.headVersion + 1;
  await store.updateRecipe(
    recipeId,
    current.recipe.headVersion,
    {
      ...draft,
      imagePath: imagePath ?? current.recipe.imagePath,
      sourceRecipeId: current.recipe.sourceRecipeId,
      origin: current.recipe.origin,
      isFavorite: current.recipe.isFavorite,
    },
    nextHeadVersion,
  );
  await store.replaceIngredients(recipeId, toIngredientRows(draft.ingredients));
  await store.replaceSteps(recipeId, toStepRows(draft.steps));
  await store.syncTags(recipeId, current.recipe.userId, draft.tags);
  return { recipeId, headVersion: nextHeadVersion };
}

/**
 * Restore a history snapshot as the new current state. The write goes through
 * the same save path, so the state being replaced is itself snapshotted with
 * change_kind 'restore' and head_version increments.
 */
export async function restoreRecipeVersionWithStore(
  store: RecipeStore,
  recipeId: string,
  historyId: string,
): Promise<SaveRecipeResult> {
  const entry = await store.getHistoryEntry(recipeId, historyId);
  if (entry === null) throw new HistoryEntryNotFoundError(recipeId, historyId);
  const parsed = recipeSnapshotSchema.safeParse(entry.snapshot);
  if (!parsed.success) throw new RecipeValidationError(parsed.error);
  const { imagePath, ...draft } = parsed.data;
  return saveRecipeWithStore(store, {
    ...draft,
    recipeId,
    changeKind: 'restore',
    userId: null,
    imagePath,
  });
}

// --- Supabase adapter ---------------------------------------------------------

interface RecipeDbRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  image_path: string | null;
  source_recipe_id: string | null;
  source_name: string | null;
  source_url: string | null;
  is_favorite: boolean;
  head_version: number;
  origin: string;
  nutrition_calories: number | null;
  nutrition_protein_grams: number | null;
  nutrition_carbohydrates_grams: number | null;
  nutrition_status: 'confirmed' | 'estimated' | 'missing' | null;
}

interface IngredientDbRow {
  position: number;
  name: string;
  quantity_num: number | null;
  quantity_den: number | null;
  unit: string | null;
  nutrition_food_id: string | null;
  user_product_id: string | null;
}

interface StepDbRow {
  position: number;
  text: string;
}

interface TagDbRow {
  id: string;
  name: string;
}

function checkError(error: { message: string } | null): void {
  if (error) throw new Error(`recipe store: ${error.message}`);
}

function toNutritionRecord(row: RecipeDbRow): NutritionRecord | null {
  if (
    row.nutrition_calories === null ||
    row.nutrition_protein_grams === null ||
    row.nutrition_carbohydrates_grams === null ||
    row.nutrition_status === null
  ) {
    return null;
  }
  return nutritionRecordSchema.parse({
    calories: Number(row.nutrition_calories),
    proteinGrams: Number(row.nutrition_protein_grams),
    carbohydratesGrams: Number(row.nutrition_carbohydrates_grams),
    sourceType: 'manual',
    sourceId: null,
    basis: 'serving',
    preparation: 'not_applicable',
    status: row.nutrition_status,
  });
}

/** Adapt a Supabase client (service role or user-scoped) to `RecipeStore`. */
export function createSupabaseRecipeStore(
  supabase: SupabaseClient,
): RecipeStore {
  return {
    async getRecipeState(recipeId) {
      const { data: recipe, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('id', recipeId)
        .maybeSingle();
      checkError(error);
      if (recipe === null) return null;
      const row = recipe as RecipeDbRow;

      const [ingredientsRes, stepsRes, linksRes] = await Promise.all([
        supabase
          .from('recipe_ingredients')
          .select(
            'position, name, quantity_num, quantity_den, unit, nutrition_food_id, user_product_id',
          )
          .eq('recipe_id', recipeId)
          .order('position'),
        supabase
          .from('recipe_steps')
          .select('position, text')
          .eq('recipe_id', recipeId)
          .order('position'),
        supabase.from('recipe_tags').select('tag_id').eq('recipe_id', recipeId),
      ]);
      checkError(ingredientsRes.error);
      checkError(stepsRes.error);
      checkError(linksRes.error);

      const tagIds = ((linksRes.data ?? []) as { tag_id: string }[]).map(
        (r) => r.tag_id,
      );
      let tags: string[] = [];
      if (tagIds.length > 0) {
        const { data: tagRows, error: tagError } = await supabase
          .from('tags')
          .select('id, name')
          .in('id', tagIds);
        checkError(tagError);
        tags = ((tagRows ?? []) as TagDbRow[]).map((t) => t.name);
      }

      return {
        recipe: {
          id: row.id,
          userId: row.user_id,
          title: row.title,
          description: row.description,
          servings: row.servings,
          prepTimeMinutes: row.prep_time_minutes,
          cookTimeMinutes: row.cook_time_minutes,
          imagePath: row.image_path,
          sourceRecipeId: row.source_recipe_id,
          sourceName: row.source_name,
          sourceUrl: row.source_url,
          isFavorite: row.is_favorite,
          headVersion: Number(row.head_version),
          origin: row.origin,
          nutrition: toNutritionRecord(row),
        },
        ingredients: ((ingredientsRes.data ?? []) as IngredientDbRow[]).map(
          (r) => ({
            position: r.position,
            name: r.name,
            quantityNum: r.quantity_num,
            quantityDen: r.quantity_den,
            unit: r.unit,
            nutritionFoodId: r.nutrition_food_id,
            userProductId: r.user_product_id,
          }),
        ),
        steps: ((stepsRes.data ?? []) as StepDbRow[]).map((r) => ({
          position: r.position,
          text: r.text,
        })),
        tags,
      };
    },

    async insertHistory({ recipeId, version, snapshot, changeKind }) {
      const { error } = await supabase.from('recipe_history').insert({
        recipe_id: recipeId,
        version,
        snapshot,
        change_kind: changeKind,
      });
      checkError(error);
    },

    async createRecipe(fields) {
      const { data, error } = await supabase
        .from('recipes')
        .insert({
          user_id: fields.userId,
          title: fields.title,
          description: fields.description,
          servings: fields.servings,
          prep_time_minutes: fields.prepTimeMinutes,
          cook_time_minutes: fields.cookTimeMinutes,
          image_path: fields.imagePath,
          source_recipe_id: fields.sourceRecipeId,
          source_name: fields.sourceName,
          source_url: fields.sourceUrl,
          origin: fields.origin,
          is_favorite: fields.isFavorite,
          nutrition_calories: fields.nutrition?.calories ?? null,
          nutrition_protein_grams: fields.nutrition?.proteinGrams ?? null,
          nutrition_carbohydrates_grams:
            fields.nutrition?.carbohydratesGrams ?? null,
          nutrition_status: fields.nutrition?.status ?? null,
          nutrition_calculated_at: fields.nutrition
            ? new Date().toISOString()
            : null,
        })
        .select('id')
        .single();
      checkError(error);
      return (data as { id: string }).id;
    },

    async updateRecipe(recipeId, expectedHeadVersion, fields, nextHeadVersion) {
      const { data, error } = await supabase
        .from('recipes')
        .update({
          title: fields.title,
          description: fields.description,
          servings: fields.servings,
          prep_time_minutes: fields.prepTimeMinutes,
          cook_time_minutes: fields.cookTimeMinutes,
          image_path: fields.imagePath,
          source_recipe_id: fields.sourceRecipeId,
          source_name: fields.sourceName,
          source_url: fields.sourceUrl,
          origin: fields.origin,
          is_favorite: fields.isFavorite,
          nutrition_calories: fields.nutrition?.calories ?? null,
          nutrition_protein_grams: fields.nutrition?.proteinGrams ?? null,
          nutrition_carbohydrates_grams:
            fields.nutrition?.carbohydratesGrams ?? null,
          nutrition_status: fields.nutrition?.status ?? null,
          nutrition_calculated_at: fields.nutrition
            ? new Date().toISOString()
            : null,
          head_version: nextHeadVersion,
        })
        .eq('id', recipeId)
        .eq('head_version', expectedHeadVersion)
        .select('id');
      checkError(error);
      if (!data || (data as unknown[]).length === 0) {
        throw new RecipeConcurrencyError(recipeId);
      }
    },

    async replaceIngredients(recipeId, rows) {
      const { error: deleteError } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('recipe_id', recipeId);
      checkError(deleteError);
      if (rows.length === 0) return;
      const { error } = await supabase.from('recipe_ingredients').insert(
        rows.map((r) => ({
          recipe_id: recipeId,
          position: r.position,
          name: r.name,
          quantity_num: r.quantityNum,
          quantity_den: r.quantityDen,
          unit: r.unit,
          nutrition_food_id: r.nutritionFoodId,
          user_product_id: r.userProductId,
        })),
      );
      checkError(error);
    },

    async replaceSteps(recipeId, rows) {
      const { error: deleteError } = await supabase
        .from('recipe_steps')
        .delete()
        .eq('recipe_id', recipeId);
      checkError(deleteError);
      if (rows.length === 0) return;
      const { error } = await supabase.from('recipe_steps').insert(
        rows.map((r) => ({
          recipe_id: recipeId,
          position: r.position,
          text: r.text,
        })),
      );
      checkError(error);
    },

    async syncTags(recipeId, userId, tagNames) {
      const names = [
        ...new Set(tagNames.map((n) => n.trim()).filter((n) => n !== '')),
      ];
      const { data: existing, error: readError } = await supabase
        .from('tags')
        .select('id, name')
        .eq('user_id', userId);
      checkError(readError);
      const idByLowerName = new Map(
        ((existing ?? []) as TagDbRow[]).map((t) => [
          t.name.toLowerCase(),
          t.id,
        ]),
      );
      const missing = names.filter((n) => !idByLowerName.has(n.toLowerCase()));
      if (missing.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('tags')
          .insert(missing.map((name) => ({ user_id: userId, name })))
          .select('id, name');
        checkError(insertError);
        for (const t of (inserted ?? []) as TagDbRow[]) {
          idByLowerName.set(t.name.toLowerCase(), t.id);
        }
      }
      const { error: deleteError } = await supabase
        .from('recipe_tags')
        .delete()
        .eq('recipe_id', recipeId);
      checkError(deleteError);
      const links = names.map((name) => ({
        recipe_id: recipeId,
        tag_id: idByLowerName.get(name.toLowerCase())!,
      }));
      if (links.length === 0) return;
      const { error } = await supabase.from('recipe_tags').insert(links);
      checkError(error);
    },

    async getHistoryEntry(recipeId, historyId) {
      const { data, error } = await supabase
        .from('recipe_history')
        .select('id, version, change_kind, snapshot')
        .eq('id', historyId)
        .eq('recipe_id', recipeId)
        .maybeSingle();
      checkError(error);
      if (data === null) return null;
      const row = data as {
        id: string;
        version: number;
        change_kind: string;
        snapshot: unknown;
      };
      return {
        id: row.id,
        version: Number(row.version),
        changeKind: row.change_kind,
        snapshot: row.snapshot,
      };
    },
  };
}

/** The single recipe save path used for every intentional write. */
export async function saveRecipe(
  supabase: SupabaseClient,
  input: SaveRecipeInput,
): Promise<SaveRecipeResult> {
  return saveRecipeWithStore(createSupabaseRecipeStore(supabase), input);
}

/** Restore a history snapshot as the new current state (kind 'restore'). */
export async function restoreRecipeVersion(
  supabase: SupabaseClient,
  recipeId: string,
  historyId: string,
): Promise<SaveRecipeResult> {
  return restoreRecipeVersionWithStore(
    createSupabaseRecipeStore(supabase),
    recipeId,
    historyId,
  );
}
