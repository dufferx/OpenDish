import { z } from 'zod';
import { ingredientSchema, recipeDraftSchema, stepSchema } from './recipe.ts';

const positionSchema = z.number().int().min(0);

/**
 * Structured edit operation on a recipe. `position` / `afterPosition`
 * are 0-based indexes into the ingredient / step arrays.
 */
export const modificationOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('addIngredient'),
    ingredient: ingredientSchema,
    afterPosition: positionSchema.optional(),
  }),
  z.object({
    kind: z.literal('removeIngredient'),
    position: positionSchema,
  }),
  z.object({
    kind: z.literal('updateIngredient'),
    position: positionSchema,
    patch: ingredientSchema.partial(),
  }),
  z.object({
    kind: z.literal('addStep'),
    step: stepSchema,
    afterPosition: positionSchema.optional(),
  }),
  z.object({
    kind: z.literal('removeStep'),
    position: positionSchema,
  }),
  z.object({
    kind: z.literal('updateStep'),
    position: positionSchema,
    text: stepSchema.shape.text,
  }),
  z.object({
    kind: z.literal('reorderSteps'),
    order: z.array(positionSchema),
  }),
  z.object({
    kind: z.literal('setServings'),
    servings: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('setTitle'),
    title: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal('setDescription'),
    description: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('setTimes'),
    prepTimeMinutes: z.number().int().min(0).nullable().optional(),
    cookTimeMinutes: z.number().int().min(0).nullable().optional(),
  }),
]);
export type ModificationOp = z.infer<typeof modificationOpSchema>;

/**
 * AI-proposed modification: the operation list for summarizing the change
 * plus the full resulting recipe for review/diff. `resultingRecipe` must
 * equal the base recipe with `operations` applied (checked by the Edge
 * Function via deterministic re-application, not by this schema).
 */
export const modificationProposalSchema = z.object({
  summary: z.string().min(1),
  operations: z.array(modificationOpSchema).min(1),
  resultingRecipe: recipeDraftSchema,
});
export type ModificationProposal = z.infer<typeof modificationProposalSchema>;
