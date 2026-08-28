import type { CookingTimerState } from '@/domain/cooking-timer.ts';

export const COOKING_SESSION_VERSION = 1;
const STORAGE_PREFIX = 'opendish:cooking-session:';

export interface CookingSession {
  version: 1;
  recipeId: string;
  stepCount: number;
  currentStepIndex: number;
  completed: boolean;
  timer: CookingTimerState;
}

export function cookingSessionKey(recipeId: string): string {
  return `${STORAGE_PREFIX}${recipeId}`;
}

export function loadCookingSession(
  storage: Pick<Storage, 'getItem'>,
  recipeId: string,
  stepCount: number,
): CookingSession | null {
  try {
    const raw = storage.getItem(cookingSessionKey(recipeId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CookingSession>;
    if (
      value.version !== COOKING_SESSION_VERSION ||
      value.recipeId !== recipeId ||
      value.stepCount !== stepCount ||
      !Number.isInteger(value.currentStepIndex) ||
      value.currentStepIndex! < 0 ||
      value.currentStepIndex! >= stepCount ||
      typeof value.completed !== 'boolean' ||
      !value.timer ||
      !['idle', 'running', 'paused', 'complete'].includes(value.timer.status) ||
      !Number.isInteger(value.timer.durationSeconds) ||
      value.timer.durationSeconds < 0
    )
      return null;
    return value as CookingSession;
  } catch {
    return null;
  }
}

export function saveCookingSession(
  storage: Pick<Storage, 'setItem'>,
  session: CookingSession,
): void {
  try {
    storage.setItem(
      cookingSessionKey(session.recipeId),
      JSON.stringify(session),
    );
  } catch {
    // Local storage may be unavailable or full; cooking remains usable in memory.
  }
}

export function createCookingSession(
  recipeId: string,
  stepCount: number,
  timer: CookingTimerState,
): CookingSession {
  return {
    version: 1,
    recipeId,
    stepCount,
    currentStepIndex: 0,
    completed: false,
    timer,
  };
}
