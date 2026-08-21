import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  applyTagFilter,
  type RecipeListItem,
} from '@/features/recipes/recipe-queries.ts';
import { RecipeListPage } from '@/features/recipes/recipe-list-page.tsx';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    storage: { from: vi.fn() },
    from: vi.fn(),
  },
}));

const sampleRecipes: RecipeListItem[] = [
  {
    id: '1',
    title: 'Tomato Pasta',
    description: 'A quick pasta dish.',
    isFavorite: true,
    tags: ['pasta', 'quick'],
    imagePath: null,
  },
  {
    id: '2',
    title: 'Chocolate Cake',
    description: 'Rich and moist dessert.',
    isFavorite: false,
    tags: ['dessert'],
    imagePath: null,
  },
  {
    id: '3',
    title: 'Quick Salad',
    description: 'Fresh greens with tomato.',
    isFavorite: false,
    tags: ['quick', 'healthy'],
    imagePath: null,
  },
];

vi.mock('@/features/recipes/recipe-queries.ts', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/recipes/recipe-queries.ts')
  >('@/features/recipes/recipe-queries.ts');
  return {
    ...actual,
    useRecipes: vi.fn(),
    useAllTags: vi.fn(),
  };
});

vi.mock('@/features/recipes/use-recipe-actions.ts', () => ({
  useRecipeActions: () => ({
    deleteRecipe: vi.fn(),
    duplicateRecipe: vi.fn(),
    toggleFavorite: vi.fn(),
    isDeleting: false,
  }),
}));

import {
  useRecipes,
  useAllTags,
  type RecipeFilters,
} from '@/features/recipes/recipe-queries.ts';

function filterRecipes(
  recipes: RecipeListItem[],
  filters: RecipeFilters,
): RecipeListItem[] {
  let result = recipes;
  const search = filters.search.trim().toLowerCase();
  if (search) {
    result = result.filter(
      (r) =>
        r.title.toLowerCase().includes(search) ||
        (r.description?.toLowerCase().includes(search) ?? false),
    );
  }
  if (filters.favoritesOnly) {
    result = result.filter((r) => r.isFavorite);
  }
  return result;
}

function renderList(
  recipes: RecipeListItem[] = sampleRecipes,
  tags: string[] = ['pasta', 'quick', 'dessert', 'healthy'],
) {
  vi.mocked(useRecipes).mockImplementation(
    (filters: RecipeFilters) =>
      ({
        data: filterRecipes(recipes, filters),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isPending: false,
        isError: false,
        isSuccess: true,
        status: 'success',
      }) as unknown as ReturnType<typeof useRecipes>,
  );
  vi.mocked(useAllTags).mockReturnValue({
    data: tags,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: true,
    status: 'success',
  } as unknown as ReturnType<typeof useAllTags>);

  render(
    <MemoryRouter>
      <RecipeListPage />
    </MemoryRouter>,
  );
}

describe('applyTagFilter', () => {
  it('returns all recipes when no tag is selected', () => {
    expect(applyTagFilter(sampleRecipes, null)).toEqual(sampleRecipes);
  });

  it('keeps only recipes with the selected tag', () => {
    expect(applyTagFilter(sampleRecipes, 'quick')).toEqual([
      sampleRecipes[0],
      sampleRecipes[2],
    ]);
  });

  it('returns an empty array when no recipe matches the tag', () => {
    expect(applyTagFilter(sampleRecipes, 'vegan')).toEqual([]);
  });
});

describe('RecipeListPage (T032)', () => {
  it('renders recipe cards and tag filter chips', () => {
    renderList();

    expect(screen.getByText('Tomato Pasta')).toBeInTheDocument();
    expect(screen.getByText('Chocolate Cake')).toBeInTheDocument();
    expect(screen.getByText('Quick Salad')).toBeInTheDocument();

    for (const tag of ['pasta', 'quick', 'dessert', 'healthy']) {
      expect(screen.getByRole('button', { name: tag })).toBeInTheDocument();
    }
  });

  it('filters by selected tag', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: 'dessert' }));

    expect(screen.getByText('Chocolate Cake')).toBeInTheDocument();
    expect(screen.queryByText('Tomato Pasta')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Salad')).not.toBeInTheDocument();
  });

  it('toggles favorites-only filter', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: /Favorites/i }));

    expect(screen.getByText('Tomato Pasta')).toBeInTheDocument();
    expect(screen.queryByText('Chocolate Cake')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Salad')).not.toBeInTheDocument();
  });

  it('shows empty state when no recipes match', () => {
    renderList([]);

    expect(screen.getByText(/No recipes yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Create recipe/i }),
    ).toBeInTheDocument();
  });
});
