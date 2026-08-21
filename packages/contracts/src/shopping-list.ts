import { z } from 'zod';
import { quantitySchema } from './recipe.ts';

export const shoppingListItemSchema = z.object({
  name: z.string().min(1).max(300),
  quantity: quantitySchema.nullable(),
  unit: z.string().nullable(),
  isPurchased: z.boolean(),
});
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;
