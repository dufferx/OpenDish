import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, Loading, EmptyState } from '@/app/states';
import { useRecipeDetail } from '@/features/recipes/recipe-queries.ts';
import {
  createTimer,
  pauseTimer,
  remainingSeconds,
  resetTimer,
  resumeTimer,
  startTimer,
  syncTimer,
  type CookingTimerState,
} from '@/domain/cooking-timer.ts';
import {
  createCookingSession,
  loadCookingSession,
  saveCookingSession,
  type CookingSession,
} from './cooking-session.ts';
import { CookingModeShell } from './cooking-mode-shell.tsx';

export function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: recipe, isLoading, error, refetch } = useRecipeDetail(id);
  const [session, setSession] = useState<CookingSession | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!recipe || !id || recipe.steps.length === 0) return;
    const existing = loadCookingSession(
      window.localStorage,
      id,
      recipe.steps.length,
    );
    setSession(
      existing ??
        createCookingSession(
          id,
          recipe.steps.length,
          createTimer(recipe.steps[0]?.durationSeconds),
        ),
    );
  }, [id, recipe]);

  useEffect(() => {
    if (!session) return;
    saveCookingSession(window.localStorage, session);
  }, [session]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const next = syncTimer(session.timer, now);
    if (next.status !== session.timer.status) {
      setSession({ ...session, timer: next });
      if (next.status === 'complete') {
        window.navigator.vibrate?.([150, 80, 150]);
      }
    }
  }, [now, session]);

  if (error)
    return (
      <ErrorState
        title="Could not load recipe"
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (isLoading || !session) return <Loading label="Loading cooking mode…" />;
  if (!recipe || recipe.steps.length === 0)
    return (
      <EmptyState
        title="No cooking steps"
        description="This recipe has no steps to cook."
        action={
          <button
            className="text-primary underline"
            onClick={() => navigate(`/recipes/${id}`)}
          >
            Back to recipe
          </button>
        }
      />
    );

  const step = recipe.steps[session.currentStepIndex];
  const timer = session.timer;
  const timerSeconds = remainingSeconds(timer, now);
  const updateStep = (index: number) =>
    setSession({
      ...session,
      currentStepIndex: index,
      timer:
        timer.status === 'running' || timer.status === 'paused'
          ? timer
          : createTimer(recipe.steps[index]?.durationSeconds),
    });
  const setTimer = (next: CookingTimerState) =>
    setSession({ ...session, timer: next });
  return (
    <CookingModeShell
      title={recipe.title}
      stepText={step.text}
      stepIndex={session.currentStepIndex}
      stepCount={recipe.steps.length}
      durationSeconds={(timer.durationSeconds || step.durationSeconds) ?? null}
      timer={timer}
      timerDisplaySeconds={timerSeconds}
      completed={session.completed}
      onExit={() => navigate(`/recipes/${recipe.id}`)}
      onPrevious={() => updateStep(Math.max(0, session.currentStepIndex - 1))}
      onNext={() =>
        updateStep(
          Math.min(recipe.steps.length - 1, session.currentStepIndex + 1),
        )
      }
      onComplete={() => setSession({ ...session, completed: true })}
      onStart={() => setTimer(startTimer(timer, now))}
      onPause={() => setTimer(pauseTimer(timer, now))}
      onResume={() => setTimer(resumeTimer(timer, now))}
      onReset={() => setTimer(resetTimer(timer))}
    />
  );
}
