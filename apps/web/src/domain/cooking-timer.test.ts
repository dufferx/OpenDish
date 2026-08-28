import { describe, expect, it } from 'vitest';
import {
  createTimer,
  pauseTimer,
  remainingSeconds,
  resetTimer,
  resumeTimer,
  startTimer,
  syncTimer,
} from './cooking-timer.ts';

describe('cooking timer', () => {
  it('derives remaining time from the absolute end timestamp', () => {
    const running = startTimer(createTimer(10), 1_000);
    expect(remainingSeconds(running, 6_501)).toBe(5);
    expect(remainingSeconds(running, 11_001)).toBe(0);
    expect(syncTimer(running, 11_001).status).toBe('complete');
  });

  it('pauses and resumes without losing remaining seconds', () => {
    const paused = pauseTimer(startTimer(createTimer(90), 0), 12_250);
    expect(paused).toMatchObject({ status: 'paused', remainingSeconds: 78 });
    const resumed = resumeTimer(paused, 20_000);
    expect(resumed.endsAtEpochMs).toBe(98_000);
  });

  it('resets while preserving the configured duration', () => {
    expect(resetTimer(startTimer(createTimer(30), 0))).toEqual(createTimer(30));
  });
});
