import { describe, expect, it } from 'vitest';
import { makeQuantity, validRecipeDraft } from '@opendish/contracts';
import {
  HistoryEntryNotFoundError,
  RecipeConcurrencyError,
  RecipeNotFoundError,
  RecipeValidationError,
  restoreRecipeVersionWithStore,
  saveRecipeWithStore,
  type ChangeKind,
  type RecipeStore,
  type SaveRecipeInput,
  type StoredIngredientRow,
  type StoredRecipeRow,
  type StoredRecipeState,
  type StoredStepRow,
} from './recipe-save.ts';
import type { RecipeSnapshot } from '@opendish/contracts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_RECIPE_ID = '22222222-2222-4222-8222-222222222222';

/** In-memory RecipeStore mirroring the real adapter's contract. */
class FakeRecipeStore implements RecipeStore {
  recipes = new Map<string, StoredRecipeRow>();
  ingredients = new Map<string, StoredIngredientRow[]>();
  steps = new Map<string, StoredStepRow[]>();
  tags = new Map<string, string[]>();
  history: {
    id: string;
    recipeId: string;
    version: number;
    snapshot: unknown;
    changeKind: string;
  }[] = [];
  private nextRecipeId = 1;
  private nextHistoryId = 1;

  async getRecipeState(recipeId: string): Promise<StoredRecipeState | null> {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return null;
    return {
      recipe: { ...recipe },
      ingredients: (this.ingredients.get(recipeId) ?? []).map((r) => ({
        ...r,
      })),
      steps: (this.steps.get(recipeId) ?? []).map((r) => ({ ...r })),
      tags: [...(this.tags.get(recipeId) ?? [])],
    };
  }

  async insertHistory(entry: {
    recipeId: string;
    version: number;
    snapshot: RecipeSnapshot;
    changeKind: ChangeKind;
  }): Promise<void> {
    this.history.push({ id: `h${this.nextHistoryId++}`, ...entry });
  }

  async createRecipe(
    fields: Omit<StoredRecipeRow, 'id' | 'headVersion'>,
  ): Promise<string> {
    const id = `00000000-0000-4000-8000-${String(this.nextRecipeId++).padStart(12, '0')}`;
    this.recipes.set(id, { ...fields, id, headVersion: 1 });
    return id;
  }

  async updateRecipe(
    recipeId: string,
    expectedHeadVersion: number,
    fields: Omit<StoredRecipeRow, 'id' | 'headVersion' | 'userId'>,
    nextHeadVersion: number,
  ): Promise<void> {
    const recipe = this.recipes.get(recipeId);
    if (!recipe || recipe.headVersion !== expectedHeadVersion) {
      throw new RecipeConcurrencyError(recipeId);
    }
    this.recipes.set(recipeId, {
      ...recipe,
      ...fields,
      headVersion: nextHeadVersion,
    });
  }

  async replaceIngredients(
    recipeId: string,
    rows: StoredIngredientRow[],
  ): Promise<void> {
    this.ingredients.set(
      recipeId,
      rows.map((r) => ({ ...r })),
    );
  }

  async replaceSteps(recipeId: string, rows: StoredStepRow[]): Promise<void> {
    this.steps.set(
      recipeId,
      rows.map((r) => ({ ...r })),
    );
  }

  async syncTags(
    recipeId: string,
    _userId: string,
    tagNames: string[],
  ): Promise<void> {
    this.tags.set(recipeId, [...tagNames]);
  }

  async getHistoryEntry(recipeId: string, historyId: string) {
    const entry = this.history.find(
      (h) => h.recipeId === recipeId && h.id === historyId,
    );
    return entry ?? null;
  }
}

function makeInput(overrides: Partial<SaveRecipeInput> = {}): SaveRecipeInput {
  return {
    ...validRecipeDraft,
    recipeId: null,
    changeKind: 'manual_edit',
    userId: USER_ID,
    ...overrides,
  };
}

describe('saveRecipeWithStore — create', () => {
  it('inserts a new recipe at head_version 1 with no history', async () => {
    const store = new FakeRecipeStore();
    const result = await saveRecipeWithStore(store, makeInput());
    expect(result.headVersion).toBe(1);
    expect(store.recipes.get(result.recipeId)).toMatchObject({
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      userId: USER_ID,
      headVersion: 1,
    });
    expect(store.history).toHaveLength(0);
  });

  it('writes ingredients and steps with positions and syncs tags', async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await saveRecipeWithStore(store, makeInput());
    expect(store.ingredients.get(recipeId)).toEqual([
      {
        position: 0,
        name: 'Spaghetti',
        quantityNum: 1,
        quantityDen: 2,
        unit: 'lb',
      },
      {
        position: 1,
        name: 'Canned tomatoes',
        quantityNum: 3,
        quantityDen: 2,
        unit: 'cups',
      },
      {
        position: 2,
        name: 'Salt',
        quantityNum: null,
        quantityDen: null,
        unit: null,
      },
    ]);
    expect(store.steps.get(recipeId)?.map((s) => [s.position, s.text])).toEqual(
      validRecipeDraft.steps.map((s, i) => [i, s.text]),
    );
    expect(store.tags.get(recipeId)).toEqual(['pasta', 'quick']);
  });

  it('requires a userId on create', async () => {
    const store = new FakeRecipeStore();
    await expect(
      saveRecipeWithStore(store, makeInput({ userId: null })),
    ).rejects.toThrow(RecipeValidationError);
    expect(store.recipes.size).toBe(0);
  });
});

describe('saveRecipeWithStore — validation', () => {
  it.each([
    ['empty title', { title: '' }],
    ['title too long', { title: 'x'.repeat(301) }],
    ['no ingredients', { ingredients: [] }],
    ['no steps', { steps: [] }],
    ['zero servings', { servings: 0 }],
    ['bad sourceUrl', { sourceUrl: 'not-a-url' }],
    ['unknown change kind', { changeKind: 'wiped' }],
    ['non-uuid recipeId', { recipeId: 'abc' }],
  ])('rejects %s and writes nothing', async (_label, override) => {
    const store = new FakeRecipeStore();
    // Deliberately invalid inputs exercise runtime (Zod) validation, so the
    // type-level cast here is intentional.
    await expect(
      saveRecipeWithStore(
        store,
        makeInput(override as Partial<SaveRecipeInput>),
      ),
    ).rejects.toThrow(RecipeValidationError);
    expect(store.recipes.size).toBe(0);
    expect(store.history).toHaveLength(0);
  });

  it('accepts every allowed change_kind', async () => {
    const allowedKinds: ChangeKind[] = [
      'manual_edit',
      'ai_applied',
      'serving_adjustment',
      'restore',
      'variant_created',
    ];
    for (const changeKind of allowedKinds) {
      const store = new FakeRecipeStore();
      const { recipeId } = await saveRecipeWithStore(store, makeInput());
      await saveRecipeWithStore(
        store,
        makeInput({ recipeId, changeKind, title: 'v2' }),
      );
      expect(store.history[0].changeKind).toBe(changeKind);
    }
  });
});

describe('saveRecipeWithStore — update', () => {
  async function seed(store: FakeRecipeStore): Promise<string> {
    const { recipeId } = await saveRecipeWithStore(store, makeInput());
    return recipeId;
  }

  it('snapshots the previous state, increments head_version, writes new state', async () => {
    const store = new FakeRecipeStore();
    const recipeId = await seed(store);
    const result = await saveRecipeWithStore(
      store,
      makeInput({ recipeId, title: 'Renamed Pasta', servings: 4 }),
    );
    expect(result.headVersion).toBe(2);
    expect(store.recipes.get(recipeId)).toMatchObject({
      title: 'Renamed Pasta',
      servings: 4,
      headVersion: 2,
    });
    expect(store.history).toHaveLength(1);
    const entry = store.history[0];
    expect(entry.version).toBe(1);
    expect(entry.changeKind).toBe('manual_edit');
    expect(entry.snapshot).toMatchObject({
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      imagePath: null,
      tags: ['pasta', 'quick'],
      ingredients: [
        { name: 'Spaghetti', quantity: makeQuantity(1, 2), unit: 'lb' },
        { name: 'Canned tomatoes', quantity: makeQuantity(3, 2), unit: 'cups' },
        { name: 'Salt', quantity: null, unit: null },
      ],
      steps: validRecipeDraft.steps,
    });
  });

  it('keeps the stored imagePath when the update omits it', async () => {
    const store = new FakeRecipeStore();
    const recipeId = await seed(store);
    store.recipes.get(recipeId)!.imagePath = 'u/r/img.jpg';
    await saveRecipeWithStore(
      store,
      makeInput({ recipeId, title: 'New title' }),
    );
    expect(store.recipes.get(recipeId)!.imagePath).toBe('u/r/img.jpg');
  });

  it('persists a variant source on create and preserves it on update', async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await saveRecipeWithStore(
      store,
      makeInput({ sourceRecipeId: SOURCE_RECIPE_ID }),
    );
    expect(store.recipes.get(recipeId)!.sourceRecipeId).toBe(SOURCE_RECIPE_ID);

    await saveRecipeWithStore(
      store,
      makeInput({ recipeId, title: 'Updated variant', sourceRecipeId: null }),
    );
    expect(store.recipes.get(recipeId)!.sourceRecipeId).toBe(SOURCE_RECIPE_ID);
  });

  it('tracks consecutive saves as ascending versions', async () => {
    const store = new FakeRecipeStore();
    const recipeId = await seed(store);
    await saveRecipeWithStore(store, makeInput({ recipeId, title: 'v2' }));
    const third = await saveRecipeWithStore(
      store,
      makeInput({ recipeId, title: 'v3', changeKind: 'serving_adjustment' }),
    );
    expect(third.headVersion).toBe(3);
    expect(store.history.map((h) => [h.version, h.changeKind])).toEqual([
      [1, 'manual_edit'],
      [2, 'serving_adjustment'],
    ]);
    expect(store.history[1].snapshot).toMatchObject({ title: 'v2' });
  });

  it('replaces ingredients/steps and re-syncs tags on update', async () => {
    const store = new FakeRecipeStore();
    const recipeId = await seed(store);
    await saveRecipeWithStore(
      store,
      makeInput({
        recipeId,
        ingredients: [
          { name: 'Rice', quantity: makeQuantity(2, 1), unit: 'cups' },
        ],
        steps: [{ text: 'Cook the rice.' }],
        tags: ['side'],
      }),
    );
    expect(store.ingredients.get(recipeId)).toHaveLength(1);
    expect(store.steps.get(recipeId)).toHaveLength(1);
    expect(store.tags.get(recipeId)).toEqual(['side']);
  });

  it('rejects updates to unknown recipes', async () => {
    const store = new FakeRecipeStore();
    await expect(
      saveRecipeWithStore(
        store,
        makeInput({ recipeId: '99999999-9999-4999-8999-999999999999' }),
      ),
    ).rejects.toThrow(RecipeNotFoundError);
  });

  it('propagates a concurrency conflict from the store', async () => {
    const store = new FakeRecipeStore();
    const recipeId = await seed(store);
    const racing = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'updateRecipe') {
          // Simulate a concurrent writer moving head_version between read and write.
          target.recipes.get(recipeId)!.headVersion += 1;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(
      saveRecipeWithStore(racing, makeInput({ recipeId, title: 'v2' })),
    ).rejects.toThrow(RecipeConcurrencyError);
  });
});

describe('reads create nothing', () => {
  it('reading state and history never writes rows', async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await saveRecipeWithStore(store, makeInput());
    const historyBefore = store.history.length;
    await store.getRecipeState(recipeId);
    await store.getHistoryEntry(recipeId, 'h1');
    expect(store.history).toHaveLength(historyBefore);
    expect(store.recipes.get(recipeId)!.headVersion).toBe(1);
  });
});

describe('restoreRecipeVersionWithStore', () => {
  it('writes the snapshot as the new state with a restore history entry', async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await saveRecipeWithStore(store, makeInput());
    await saveRecipeWithStore(
      store,
      makeInput({ recipeId, title: 'v2', servings: 8 }),
    );
    const historyId = store.history[0].id; // snapshot of v1

    const result = await restoreRecipeVersionWithStore(
      store,
      recipeId,
      historyId,
    );

    expect(result.headVersion).toBe(3);
    expect(store.recipes.get(recipeId)).toMatchObject({
      title: validRecipeDraft.title,
      servings: validRecipeDraft.servings,
      headVersion: 3,
    });
    expect(store.history).toHaveLength(2);
    // Restoring itself snapshots the state it replaced (v2) with kind 'restore'.
    expect(store.history[1]).toMatchObject({
      version: 2,
      changeKind: 'restore',
    });
    expect(store.history[1].snapshot).toMatchObject({
      title: 'v2',
      servings: 8,
    });
  });

  it('rejects an unknown history entry', async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await saveRecipeWithStore(store, makeInput());
    await expect(
      restoreRecipeVersionWithStore(store, recipeId, 'nope'),
    ).rejects.toThrow(HistoryEntryNotFoundError);
  });

  it('rejects a snapshot that violates the RecipeSnapshot schema', async () => {
    const store = new FakeRecipeStore();
    const { recipeId } = await saveRecipeWithStore(store, makeInput());
    store.history.push({
      id: 'corrupt',
      recipeId,
      version: 1,
      snapshot: { title: '' },
      changeKind: 'manual_edit',
    });
    await expect(
      restoreRecipeVersionWithStore(store, recipeId, 'corrupt'),
    ).rejects.toThrow(RecipeValidationError);
    expect(store.recipes.get(recipeId)!.headVersion).toBe(1);
  });
});
