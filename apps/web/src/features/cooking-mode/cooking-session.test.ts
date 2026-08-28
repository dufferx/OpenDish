import { describe, expect, it } from 'vitest';
import { createTimer } from '@/domain/cooking-timer.ts';
import {
  createCookingSession,
  cookingSessionKey,
  loadCookingSession,
  saveCookingSession,
} from './cooking-session.ts';

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('cooking sessions', () => {
  it('round trips sessions under a recipe-specific key', () => {
    const store = storage();
    const session = createCookingSession('recipe-1', 2, createTimer(30));
    saveCookingSession(store, session);
    expect(store.values.has(cookingSessionKey('recipe-1'))).toBe(true);
    expect(loadCookingSession(store, 'recipe-1', 2)).toEqual(session);
    expect(loadCookingSession(store, 'recipe-2', 2)).toBeNull();
  });

  it('ignores corrupt or incompatible storage safely', () => {
    const store = storage();
    store.values.set(cookingSessionKey('recipe-1'), '{not json');
    expect(loadCookingSession(store, 'recipe-1', 2)).toBeNull();
    store.values.set(
      cookingSessionKey('recipe-1'),
      JSON.stringify({ version: 1, recipeId: 'recipe-1', stepCount: 3 }),
    );
    expect(loadCookingSession(store, 'recipe-1', 2)).toBeNull();
  });
});
