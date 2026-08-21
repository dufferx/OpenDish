import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeQuantity, type RecipeSnapshot } from '@opendish/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecipeHistoryPanel } from '@/features/recipe-history/recipe-history-panel.tsx';

interface QueuedHistoryResponse {
  data?: unknown[] | null;
  error?: { message: string } | null;
  waitFor?: Promise<void>;
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  restoreRecipeVersion: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  responseQueue: [] as QueuedHistoryResponse[],
  orderCalls: [] as Array<[string, { ascending: boolean } | undefined]>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
  },
}));

vi.mock('@/domain/recipe-save.ts', () => ({
  restoreRecipeVersion: mocks.restoreRecipeVersion,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

function makeHistoryBuilder() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(async (column: string, options?: { ascending: boolean }) => {
      mocks.orderCalls.push([column, options]);
      const next = mocks.responseQueue.shift() ?? { data: [], error: null };
      if (next.waitFor) await next.waitFor;
      return {
        data: next.data ?? null,
        error: next.error ?? null,
      };
    }),
  };

  return builder;
}

const PANCAKE_SNAPSHOT: RecipeSnapshot = {
  title: 'Pancakes',
  description: 'Weekend stack',
  servings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 15,
  sourceName: 'Grandma',
  sourceUrl: 'https://example.com/pancakes',
  imagePath: null,
  ingredients: [
    { name: 'Flour', quantity: makeQuantity(2, 1), unit: 'cups' },
    { name: 'Milk', quantity: makeQuantity(3, 2), unit: 'cups' },
  ],
  steps: [{ text: 'Whisk.' }, { text: 'Cook.' }],
  tags: ['breakfast'],
};

const WAFFLE_SNAPSHOT: RecipeSnapshot = {
  ...PANCAKE_SNAPSHOT,
  title: 'Waffles',
  description: 'Crisp edges',
  tags: ['breakfast', 'brunch'],
};

function queueHistoryResponse(response: QueuedHistoryResponse) {
  mocks.responseQueue.push(response);
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPanel({
  recipeId = 'recipe-1',
  onRestored = vi.fn(),
}: {
  recipeId?: string;
  onRestored?: () => void;
} = {}) {
  const queryClient = createQueryClient();
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <RecipeHistoryPanel recipeId={recipeId} onRestored={onRestored} />
    </QueryClientProvider>,
  );

  return { queryClient, user, onRestored };
}

describe('RecipeHistoryPanel', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.restoreRecipeVersion.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.responseQueue.length = 0;
    mocks.orderCalls.length = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table !== 'recipe_history') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return makeHistoryBuilder();
    });
    mocks.restoreRecipeVersion.mockResolvedValue({
      recipeId: 'recipe-1',
      headVersion: 4,
    });
  });

  it('shows a loading state before the history query resolves', async () => {
    let release = () => {};
    const waitFor = new Promise<void>((resolve) => {
      release = resolve;
    });

    queueHistoryResponse({ data: [], error: null, waitFor });
    renderPanel();

    expect(screen.getByText('Loading history…')).toBeInTheDocument();

    release();

    expect(await screen.findByText('No saved history yet')).toBeInTheDocument();
  });

  it('renders history entries, orders by newest first, and shows a snapshot dialog', async () => {
    queueHistoryResponse({
      data: [
        {
          id: 'history-2',
          recipe_id: 'recipe-1',
          version: 2,
          change_kind: 'manual_edit',
          created_at: '2026-08-20T11:30:00.000Z',
          snapshot: WAFFLE_SNAPSHOT,
        },
        {
          id: 'history-1',
          recipe_id: 'recipe-1',
          version: 1,
          change_kind: 'variant_created',
          created_at: '2026-08-19T11:30:00.000Z',
          snapshot: PANCAKE_SNAPSHOT,
        },
      ],
      error: null,
    });

    const { user } = renderPanel();

    const entries = await screen.findByRole('list', {
      name: /recipe history entries/i,
    });
    const items = within(entries).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Version 2')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Version 1')).toBeInTheDocument();
    expect(mocks.orderCalls).toEqual([['created_at', { ascending: false }]]);

    await user.click(
      screen.getByRole('button', { name: /view version 2 snapshot/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Waffles')).toBeInTheDocument();
    expect(within(dialog).getByText('Crisp edges')).toBeInTheDocument();
    expect(within(dialog).getByText('1 ½ cups Milk')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: /view original source/i }),
    ).toHaveAttribute('href', 'https://example.com/pancakes');
  });

  it('shows an error state and retries the history query', async () => {
    queueHistoryResponse({
      error: { message: 'network down' },
    });
    queueHistoryResponse({
      data: [],
      error: null,
    });

    const { user } = renderPanel();

    expect(
      await screen.findByText('Could not load recipe history'),
    ).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('No saved history yet')).toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it('restores a version, invalidates related queries, and calls onRestored', async () => {
    queueHistoryResponse({
      data: [
        {
          id: 'history-2',
          recipe_id: 'recipe-1',
          version: 2,
          change_kind: 'manual_edit',
          created_at: '2026-08-20T11:30:00.000Z',
          snapshot: WAFFLE_SNAPSHOT,
        },
      ],
      error: null,
    });

    const { queryClient, user, onRestored } = renderPanel();
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue();

    await screen.findByText('Waffles');
    await user.click(
      screen.getByRole('button', { name: /restore version 2/i }),
    );

    await waitFor(() => {
      expect(mocks.restoreRecipeVersion).toHaveBeenCalledWith(
        expect.any(Object),
        'recipe-1',
        'history-2',
      );
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recipes'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['recipe', 'recipe-1'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['recipe-history', 'recipe-1'],
    });
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        /version 2 restored\. the latest recipe data has been refreshed\./i,
      ),
    ).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Recipe version restored.');
  });

  it('surfaces restore errors without calling onRestored', async () => {
    queueHistoryResponse({
      data: [
        {
          id: 'history-1',
          recipe_id: 'recipe-1',
          version: 1,
          change_kind: 'manual_edit',
          created_at: '2026-08-20T11:30:00.000Z',
          snapshot: PANCAKE_SNAPSHOT,
        },
      ],
      error: null,
    });
    mocks.restoreRecipeVersion.mockRejectedValue(new Error('restore failed'));

    const { user, onRestored } = renderPanel();

    await screen.findByText('Pancakes');
    await user.click(
      screen.getByRole('button', { name: /restore version 1/i }),
    );

    expect(await screen.findByText('restore failed')).toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('restore failed');
  });
});
