// Shared domain contracts: Zod schemas + inferred types, the AiProvider
// boundary, and deterministic test utilities. Runtime-neutral (no Node or
// Deno APIs) so both the Vite client and Supabase Edge Functions can
// consume this package verbatim.
export * from './recipe.ts';
export * from './nutrition.ts';
export * from './nutrition-calculator.ts';
export * from './modification.ts';
export * from './apply-modification.ts';
export * from './conversation.ts';
export * from './shopping-list.ts';
export * from './ai-provider.ts';
export * from './testing/fixtures.ts';
export * from './testing/fake-provider.ts';
