import { recipeSnapshotSchema, type RecipeSnapshot } from '@opendish/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { restoreRecipeVersion } from '@/domain/recipe-save.ts';
import { supabase } from '@/lib/supabase';

export interface RecipeHistoryEntry {
  id: string;
  recipeId: string;
  version: number;
  changeKind: string;
  createdAt: string;
  snapshot: RecipeSnapshot;
}

interface RawRecipeHistoryRow {
  id: string;
  recipe_id: string;
  version: number;
  change_kind: string;
  created_at: string;
  snapshot: unknown;
}

interface RestoreRecipeHistoryVersionVariables {
  recipeId: string;
  historyId: string;
  onRestored: () => void;
}

export function recipeHistoryQueryKey(recipeId: string | undefined) {
  return ['recipe-history', recipeId] as const;
}

export function useRecipeHistory(recipeId: string | undefined) {
  return useQuery({
    queryKey: recipeHistoryQueryKey(recipeId),
    queryFn: async (): Promise<RecipeHistoryEntry[]> => {
      if (!recipeId) return [];

      const { data, error } = await supabase
        .from('recipe_history')
        .select('id, recipe_id, version, change_kind, created_at, snapshot')
        .eq('recipe_id', recipeId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);

      return ((data ?? []) as RawRecipeHistoryRow[]).map((row) => ({
        id: row.id,
        recipeId: row.recipe_id,
        version: Number(row.version),
        changeKind: row.change_kind,
        createdAt: row.created_at,
        snapshot: recipeSnapshotSchema.parse(row.snapshot),
      }));
    },
    enabled: !!recipeId,
    staleTime: 30_000,
  });
}

export function useRestoreRecipeHistoryVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recipeId,
      historyId,
    }: RestoreRecipeHistoryVersionVariables) =>
      restoreRecipeVersion(supabase, recipeId, historyId),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recipes'] }),
        queryClient.invalidateQueries({
          queryKey: ['recipe', variables.recipeId],
        }),
        queryClient.invalidateQueries({
          queryKey: recipeHistoryQueryKey(variables.recipeId),
        }),
      ]);

      variables.onRestored();
      toast.success('Recipe version restored.');
    },
    onError: (error) => {
      toast.error(error.message ?? 'Could not restore that version.');
    },
  });
}
