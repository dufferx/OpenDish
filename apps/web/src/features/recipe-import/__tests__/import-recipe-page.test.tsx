import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportRecipePage } from '@/features/recipe-import/import-recipe-page.tsx';
import {
  importRecipe,
  ImportRecipeError,
  type ImportResult,
} from '@/features/recipe-import/import-recipe-api.ts';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    storage: { from: vi.fn() },
  },
}));

vi.mock('@/features/recipe-editor/use-recipe-mutation.ts', () => ({
  useRecipeMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ recipeId: 'r1', headVersion: 1 }),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/features/recipe-import/import-recipe-api.ts', async () => {
  const actual = await vi.importActual(
    '@/features/recipe-import/import-recipe-api.ts',
  );
  return {
    ...(actual as object),
    importRecipe: vi.fn(),
  };
});

const mockImportRecipe = vi.mocked(importRecipe);

const SUCCESS_RESULT: ImportResult = {
  draft: {
    title: 'Imported Soup',
    description: 'A simple soup.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    sourceName: null,
    sourceUrl: 'https://example.com/soup',
    ingredients: [
      { name: 'Lentils', quantity: { num: 1, den: 1 }, unit: 'cup' },
    ],
    steps: [{ text: 'Simmer lentils.' }],
    tags: [],
  },
  extractionMethod: 'structured_markup',
};

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ImportRecipePage />
    </MemoryRouter>,
  );
  return { user };
}

describe('ImportRecipePage (T040/T042)', () => {
  beforeEach(() => {
    mockImportRecipe.mockReset();
  });

  it('extracts from a URL and shows the review screen', async () => {
    mockImportRecipe.mockResolvedValue(SUCCESS_RESULT);
    const { user } = renderPage();

    await user.type(
      screen.getByLabelText(/Recipe URL/i),
      'https://example.com/soup',
    );
    await user.click(screen.getByRole('button', { name: /Extract recipe/i }));

    await waitFor(() => {
      expect(screen.getByText(/Review imported recipe/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Title/i)).toHaveValue('Imported Soup');
    expect(
      screen.getByText(/Extracted from structured page data/i),
    ).toBeInTheDocument();
  });

  it('extracts from pasted text and shows the review screen', async () => {
    mockImportRecipe.mockResolvedValue(SUCCESS_RESULT);
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: /Paste text/i }));
    await user.type(
      screen.getByLabelText(/Recipe text/i),
      'Lentil soup: 1 cup lentils, simmer.',
    );
    await user.click(screen.getByRole('button', { name: /Extract recipe/i }));

    await waitFor(() => {
      expect(screen.getByText(/Review imported recipe/i)).toBeInTheDocument();
    });

    expect(mockImportRecipe).toHaveBeenCalledWith({
      mode: 'text',
      text: 'Lentil soup: 1 cup lentils, simmer.',
    });
  });

  it('shows a loading state while extracting', async () => {
    mockImportRecipe.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(SUCCESS_RESULT), 100);
        }),
    );
    const { user } = renderPage();

    await user.type(
      screen.getByLabelText(/Recipe URL/i),
      'https://example.com',
    );
    await user.click(screen.getByRole('button', { name: /Extract recipe/i }));

    expect(screen.getByText(/Extracting…/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Extracting…/i })).toBeDisabled();
  });

  it('shows a failure message and a manual-entry link when extraction fails', async () => {
    mockImportRecipe.mockRejectedValue(
      new ImportRecipeError(
        'no_recipe_found',
        'No usable recipe was found in the provided content.',
      ),
    );
    const { user } = renderPage();

    await user.type(
      screen.getByLabelText(/Recipe URL/i),
      'https://example.com',
    );
    await user.click(screen.getByRole('button', { name: /Extract recipe/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/No recipe found/i);
    });

    const manualLink = screen.getByRole('link', {
      name: /create the recipe manually instead/i,
    });
    expect(manualLink).toHaveAttribute('href', '/recipes/new');
  });

  it('returns to the import form when the review is discarded', async () => {
    mockImportRecipe.mockResolvedValue(SUCCESS_RESULT);
    const { user } = renderPage();

    await user.type(
      screen.getByLabelText(/Recipe URL/i),
      'https://example.com',
    );
    await user.click(screen.getByRole('button', { name: /Extract recipe/i }));

    await waitFor(() => {
      expect(screen.getByText(/Review imported recipe/i)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: /Discard and start over/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Import a recipe/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Recipe URL/i)).toHaveValue('');
  });
});
