import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/lib/supabase';

import type {
  UserProduct,
  UserProductDbRow,
  UserProductInput,
} from './product-types.ts';

const PRODUCTS_QUERY_KEY = ['user-products'] as const;

function rowToProduct(row: UserProductDbRow): UserProduct {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    servingSizeText: row.serving_size_text,
    servingMassG: row.serving_mass_g,
    servingVolumeMl: row.serving_volume_ml,
    calories: Number(row.calories),
    proteinGrams: Number(row.protein_grams),
    carbohydratesGrams: Number(row.carbohydrates_grams),
    status: row.status,
    labelImagePath: row.label_image_path,
    createdAt: row.created_at,
  };
}

export function useUserProducts() {
  return useQuery({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: async (): Promise<UserProduct[]> => {
      const { data, error } = await supabase
        .from('user_products')
        .select(
          'id, user_id, name, brand, serving_size_text, serving_mass_g, serving_volume_ml, calories, protein_grams, carbohydrates_grams, status, label_image_path, created_at',
        )
        .order('name');
      if (error) throw new Error(error.message);
      return ((data ?? []) as UserProductDbRow[]).map(rowToProduct);
    },
    staleTime: 30_000,
  });
}

export function useUserProductActions() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const userId = auth.status === 'authenticated' ? auth.session.user.id : null;

  const saveProduct = useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id?: string;
      input: UserProductInput;
    }) => {
      if (!userId) throw new Error('You must be signed in to save products.');
      const payload = {
        user_id: userId,
        name: input.name,
        brand: input.brand,
        serving_size_text: input.servingSizeText,
        serving_mass_g: input.servingMassG,
        serving_volume_ml: input.servingVolumeMl,
        calories: input.calories,
        protein_grams: input.proteinGrams,
        carbohydrates_grams: input.carbohydratesGrams,
        status: input.status,
      };
      const query = id
        ? supabase.from('user_products').update(payload).eq('id', id)
        : supabase.from('user_products').insert(payload);
      const { error } = await query;
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      toast.success('Product saved.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('user_products')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      toast.success('Product deleted.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return { saveProduct, deleteProduct };
}
