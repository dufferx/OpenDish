import { z } from 'zod';
import { modificationProposalSchema } from './modification.ts';

export const messageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const conversationMessageSchema = z.object({
  role: messageRoleSchema,
  content: z.string().min(1),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const recipeAnswerSchema = z.object({
  kind: z.literal('answer'),
  content: z.string(),
});
export type RecipeAnswer = z.infer<typeof recipeAnswerSchema>;

/** One turn of the per-recipe chat: either a text answer or a proposal. */
export const chatOutcomeSchema = z.discriminatedUnion('kind', [
  recipeAnswerSchema,
  z.object({
    kind: z.literal('proposal'),
    proposal: modificationProposalSchema,
  }),
]);
export type ChatOutcome = z.infer<typeof chatOutcomeSchema>;
