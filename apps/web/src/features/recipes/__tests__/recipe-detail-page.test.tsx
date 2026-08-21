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

function renderPage(detail: RecipeDetail = recipe) {
  vi.mocked(useRecipeDetail).mockReturnValue({
    data: detail,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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
});
