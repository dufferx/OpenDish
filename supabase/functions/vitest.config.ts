import { defineConfig } from 'vitest/config';

// Edge Function code targets Deno, but all logic lives in pure modules with
// side effects (network/DB) behind injected interfaces, so the suite runs on
// Node via the workspace Vitest. Only the thin Deno entrypoints
// (`*/index.ts`) are excluded from tests.
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
