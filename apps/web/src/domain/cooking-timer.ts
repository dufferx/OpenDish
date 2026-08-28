export type CookingTimerStatus = 'idle' | 'running' | 'paused' | 'complete';

export interface CookingTimerState {
  durationSeconds: number;
  status: CookingTimerStatus;
  endsAtEpochMs: number | null;
  remainingSeconds: number | null;
}

export function createTimer(
  durationSeconds: number | null | undefined,
): CookingTimerState {
  return {
    durationSeconds:
      durationSeconds && durationSeconds > 0 ? durationSeconds : 0,
    status: 'idle',
    endsAtEpochMs: null,
    remainingSeconds: null,
  };
}

export function remainingSeconds(
  timer: CookingTimerState,
  now = Date.now(),
): number {
  if (timer.status === 'running' && timer.endsAtEpochMs !== null) {
    return Math.max(0, Math.ceil((timer.endsAtEpochMs - now) / 1000));
  }
  if (timer.status === 'paused')
    return Math.max(0, timer.remainingSeconds ?? 0);
  if (timer.status === 'complete') return 0;
  return Math.max(0, timer.durationSeconds);
}

export function startTimer(
  timer: CookingTimerState,
  now = Date.now(),
): CookingTimerState {
  if (timer.durationSeconds <= 0) return timer;
  return {
    ...timer,
    status: 'running',
    endsAtEpochMs: now + timer.durationSeconds * 1000,
    remainingSeconds: null,
  };
}

export function pauseTimer(
  timer: CookingTimerState,
  now = Date.now(),
): CookingTimerState {
  if (timer.status !== 'running') return timer;
  const remaining = remainingSeconds(timer, now);
  return remaining === 0
    ? { ...timer, status: 'complete', endsAtEpochMs: null, remainingSeconds: 0 }
    : {
        ...timer,
        status: 'paused',
        endsAtEpochMs: null,
        remainingSeconds: remaining,
      };
}

export function resumeTimer(
  timer: CookingTimerState,
  now = Date.now(),
): CookingTimerState {
  if (timer.status !== 'paused' || (timer.remainingSeconds ?? 0) <= 0) {
    return timer.status === 'paused'
      ? { ...timer, status: 'complete', remainingSeconds: 0 }
      : timer;
  }
  return {
    ...timer,
    status: 'running',
    endsAtEpochMs: now + timer.remainingSeconds! * 1000,
    remainingSeconds: null,
  };
}

export function resetTimer(timer: CookingTimerState): CookingTimerState {
  return createTimer(timer.durationSeconds);
}

export function syncTimer(
  timer: CookingTimerState,
  now = Date.now(),
): CookingTimerState {
  return timer.status === 'running' && remainingSeconds(timer, now) === 0
    ? { ...timer, status: 'complete', endsAtEpochMs: null, remainingSeconds: 0 }
    : timer;
}

export function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
