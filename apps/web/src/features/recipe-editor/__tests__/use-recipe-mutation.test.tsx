import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validRecipeDraft } from '@opendish/contracts';

import { useRecipeMutation } from '@/features/recipe-editor/use-recipe-mutation';

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  saveRecipe: vi.fn(),
  uploadRecipeImage: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
  },
}));

vi.mock('@/domain/recipe-save.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/domain/recipe-save.ts')>();
  return { ...original, saveRecipe: mocks.saveRecipe };
});

vi.mock('@/lib/recipe-images.ts', () => ({
  uploadRecipeImage: mocks.uploadRecipeImage,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useRecipeMutation', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.saveRecipe.mockReset();
    mocks.uploadRecipeImage.mockReset();
    mocks.saveRecipe.mockResolvedValue({
      recipeId: '10000000-0000-4000-8000-000000000001',
      headVersion: 1,
    });
  });

  it('assigns the verified Supabase user when creating a recipe', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: TEST_USER_ID } },
      error: null,
    });
    const { result } = renderHook(() => useRecipeMutation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        draft: {
          ...validRecipeDraft,
          recipeId: null,
          changeKind: 'manual_edit',
          userId: null,
          origin: 'ai_generated',
        },
      });
    });

    expect(mocks.saveRecipe).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipeId: null,
        userId: TEST_USER_ID,
        origin: 'ai_generated',
      }),
    );
  });

  it('fails safely when no authenticated user can be verified', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const { result } = renderHook(() => useRecipeMutation(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        draft: {
          ...validRecipeDraft,
          recipeId: null,
          changeKind: 'manual_edit',
          userId: null,
          origin: 'ai_generated',
        },
      }),
    ).rejects.toThrow('You must be signed in to create recipes.');

    expect(mocks.saveRecipe).not.toHaveBeenCalled();
  });
});
