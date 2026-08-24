import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeQuantity } from '@opendish/contracts';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useRecipeDetail,
  type RecipeDetail,
} from '@/features/recipes/recipe-queries.ts';
import { RecipeDetailPage } from '@/features/recipes/recipe-detail-page.tsx';

const saveServingAdjustment = vi.fn();
const addRecipeToList = vi.fn();
const historyPanelProps = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    storage: { from: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock('@/features/recipes/recipe-queries.ts', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/recipes/recipe-queries.ts')
  >('@/features/recipes/recipe-queries.ts');
  return {
    ...actual,
    useRecipeDetail: vi.fn(),
  };
});

vi.mock('@/features/recipes/use-recipe-actions.ts', () => ({
  useRecipeActions: () => ({
    deleteRecipe: vi.fn(),
    duplicateRecipe: vi.fn(),
    toggleFavorite: vi.fn(),
    saveServingAdjustment,
    isDeleting: false,
    isDuplicating: false,
    isSavingServingAdjustment: false,
  }),
}));

vi.mock('@/features/recipe-history', () => ({
  RecipeHistoryPanel: ({
    recipeId,
    onRestored,
  }: {
    recipeId: string;
    onRestored: () => void;
  }) => {
    historyPanelProps({ recipeId, onRestored });
    return (
      <section aria-label="recipe history">
        <p>History for {recipeId}</p>
        <button type="button" onClick={onRestored}>
          Restore revision
        </button>
      </section>
    );
  },
}));

vi.mock('@/features/recipe-conversation', () => ({
  RecipeConversation: () => <section aria-label="recipe conversation" />,
}));

vi.mock('@/features/shopping-list/shopping-list-queries.ts', () => ({
  useShoppingListActions: () => ({
    addRecipe: addRecipeToList,
    isAddingRecipe: false,
  }),
}));

const recipe: RecipeDetail = {
  id: 'recipe-1',
  title: 'Test pancakes',
  description: null,
  servings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 15,
  sourceName: null,
  sourceUrl: null,
  sourceRecipeId: null,
  sourceRecipe: null,
  variantRecipes: [],
  isFavorite: false,
  imagePath: null,
  ingredients: [
    { name: 'Flour', quantity: makeQuantity(2, 1), unit: 'cups' },
    { name: 'Milk', quantity: makeQuantity(3, 1), unit: 'cups' },
    { name: 'Salt to taste', quantity: null, unit: null },
  ],
  steps: [{ text: 'Mix everything.' }],
  tags: [],
  origin: 'manual',
  headVersion: 1,
};

function renderPage(
  detail: RecipeDetail = recipe,
  options: { refetch?: ReturnType<typeof vi.fn> } = {},
) {
  const refetch = options.refetch ?? vi.fn();
  vi.mocked(useRecipeDetail).mockReturnValue({
    data: detail,
    isLoading: false,
    error: null,
    refetch,
    isPending: false,
    isError: false,
    isSuccess: true,
    status: 'success',
  } as unknown as ReturnType<typeof useRecipeDetail>);

  render(
    <MemoryRouter initialEntries={[`/recipes/${detail.id}`]}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RecipeDetailPage servings scaler (T045)', () => {
  beforeEach(() => {
    saveServingAdjustment.mockReset();
    saveServingAdjustment.mockResolvedValue(undefined);
    addRecipeToList.mockReset();
    addRecipeToList.mockResolvedValue(undefined);
    historyPanelProps.mockReset();
  });

  it('temporarily scales exact quantities and preserves quantity-less ingredients', async () => {
    const user = userEvent.setup();
    renderPage();

    const servings = screen.getByRole('spinbutton', { name: /servings/i });
    expect(servings).toHaveValue(4);

    await user.clear(servings);
    await user.type(servings, '2');

    expect(servings).toHaveValue(2);
    expect(screen.getByText('2 servings')).toBeInTheDocument();
    expect(screen.getByText('Flour').closest('li')).toHaveTextContent(
      '1 cup Flour',
    );
    expect(screen.getByText('Milk').closest('li')).toHaveTextContent(
      '1 ½ cups Milk',
    );
    expect(screen.getByText('Salt to taste').closest('li')).toHaveTextContent(
      'Salt to taste',
    );
    expect(saveServingAdjustment).not.toHaveBeenCalled();
  });

  it('saves only through the explicit serving-adjustment action', async () => {
    const user = userEvent.setup();
    renderPage();

    const servings = screen.getByRole('spinbutton', { name: /servings/i });
    await user.clear(servings);
    await user.type(servings, '2');

    expect(saveServingAdjustment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /save adjustment/i }));

    expect(saveServingAdjustment).toHaveBeenCalledTimes(1);
    expect(saveServingAdjustment).toHaveBeenCalledWith({
      recipe,
      targetServings: 2,
    });
  });

  it.each([0, 101])(
    'rejects invalid target servings %s with actionable feedback',
    async (targetServings) => {
      const user = userEvent.setup();
      renderPage();

      const servings = screen.getByRole('spinbutton', { name: /servings/i });
      await user.clear(servings);
      await user.type(servings, String(targetServings));

      expect(
        screen.getByText(/servings must be an integer between 1 and 100/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /save adjustment/i }),
      ).toBeDisabled();
      expect(saveServingAdjustment).not.toHaveBeenCalled();
    },
  );

  it('renders absent optional fields cleanly without hiding the servings control', () => {
    renderPage({
      ...recipe,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      sourceName: null,
      sourceUrl: null,
      description: null,
      imagePath: null,
    });

    expect(screen.getByRole('heading', { name: recipe.title })).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: /servings/i })).toHaveValue(
      4,
    );
    expect(
      screen.queryByRole('heading', { name: 'Source' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/undefined|null|coming soon/i),
    ).not.toBeInTheDocument();
  });

  it('opens the add-to-shopping-list dialog and calls addRecipe on confirm', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add to list/i }));

    const dialog = screen.getByRole('dialog', {
      name: /add to shopping list/i,
    });
    expect(dialog).toBeInTheDocument();

    const servings = screen.getByRole('spinbutton', { name: /servings/i });
    expect(servings).toHaveValue(4);

    await user.clear(servings);
    await user.type(servings, '2');

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(addRecipeToList).toHaveBeenCalledTimes(1);
    expect(addRecipeToList).toHaveBeenCalledWith({
      recipe,
      servings: 2,
    });
  });

  it('shows the source relationship badge and wires history restores to refetch', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    renderPage(
      {
        ...recipe,
        sourceRecipeId: 'recipe-source',
        sourceRecipe: {
          id: 'recipe-source',
          title: 'Original pancakes',
        },
      },
      { refetch },
    );

    expect(
      screen.getByRole('link', { name: /variant of original pancakes/i }),
    ).toHaveAttribute('href', '/recipes/recipe-source');
    expect(screen.getByText('History for recipe-1')).toBeInTheDocument();
    expect(historyPanelProps).toHaveBeenCalledWith({
      recipeId: 'recipe-1',
      onRestored: expect.any(Function),
    });

    await user.click(screen.getByRole('button', { name: /restore revision/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('lists child variants when the recipe is a source recipe', () => {
    renderPage({
      ...recipe,
      variantRecipes: [
        { id: 'variant-1', title: 'Pancakes with berries' },
        { id: 'variant-2', title: 'Protein pancakes' },
      ],
    });

    expect(screen.getByText('2 variants')).toBeInTheDocument();
    expect(screen.getByText('Recipe family')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Pancakes with berries' }),
    ).toHaveAttribute('href', '/recipes/variant-1');
    expect(
      screen.getByRole('link', { name: 'Protein pancakes' }),
    ).toHaveAttribute('href', '/recipes/variant-2');
  });

  it('omits the standalone variants warning when the recipe has no child variants', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(
      screen.getByText(/will be permanently deleted\.$/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/standalone recipes/i)).not.toBeInTheDocument();
  });

  it('warns that child variants become standalone when deleting a source recipe', async () => {
    const user = userEvent.setup();
    renderPage({
      ...recipe,
      variantRecipes: [
        { id: 'variant-1', title: 'Pancakes with berries' },
        { id: 'variant-2', title: 'Protein pancakes' },
      ],
    });

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(
      screen.getByText(
        /2 variants currently linked to this recipe will become standalone recipes/i,
      ),
    ).toBeInTheDocument();
  });
});

describe('RecipeDetailPage drawer assistant (T108)', () => {
  beforeEach(() => {
    saveServingAdjustment.mockReset();
    saveServingAdjustment.mockResolvedValue(undefined);
    addRecipeToList.mockReset();
    addRecipeToList.mockResolvedValue(undefined);
    historyPanelProps.mockReset();
  });

  it('keeps the assistant mounted as a persistent drawer entry point', () => {
    renderPage();

    expect(screen.getByLabelText('recipe conversation')).toBeInTheDocument();
    expect(
      screen.queryByRole('tablist', { name: /recipe view/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps the recipe visible at full width instead of creating split panes', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Ingredients' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Steps' })).toBeVisible();
    expect(screen.getByLabelText('recipe conversation')).toBeInTheDocument();
    expect(document.getElementById('recipe-pane')).toBeNull();
    expect(document.getElementById('assistant-pane')).toBeNull();
  });
});
