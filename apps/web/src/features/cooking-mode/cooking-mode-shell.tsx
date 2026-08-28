import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatTimer, type CookingTimerState } from '@/domain/cooking-timer.ts';

interface CookingModeShellProps {
  title: string;
  stepText: string;
  stepIndex: number;
  stepCount: number;
  durationSeconds: number | null;
  timer: CookingTimerState;
  timerDisplaySeconds: number;
  completed: boolean;
  onExit: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onComplete: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}

export function CookingModeShell(props: CookingModeShellProps) {
  const {
    title,
    stepText,
    stepIndex,
    stepCount,
    durationSeconds,
    timer,
    timerDisplaySeconds,
    completed,
  } = props;
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">
            Step {stepIndex + 1} of {stepCount}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={props.onExit}>
          <XIcon className="mr-1.5 size-4" /> Exit
        </Button>
      </header>
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }}
        />
      </div>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 overflow-y-auto px-5 py-8 pb-32">
        {completed ? (
          <div className="grid justify-items-center gap-4 text-center">
            <CheckCircle2Icon className="size-16 text-primary" />
            <h1 className="text-3xl font-semibold">You’re done!</h1>
            <p className="text-muted-foreground">All steps are complete.</p>
            <Button onClick={props.onExit}>Back to recipe</Button>
          </div>
        ) : (
          <>
            <p className="text-center text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Step {stepIndex + 1}
            </p>
            <Card>
              <CardContent className="p-6 sm:p-10">
                <p className="text-xl leading-relaxed sm:text-3xl">
                  {stepText}
                </p>
              </CardContent>
            </Card>
            {durationSeconds ? (
              <Card aria-label="Step timer">
                <CardContent className="grid gap-3 p-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    Optional timer
                  </p>
                  <p
                    className={`font-mono text-4xl font-semibold ${timer.status === 'complete' ? 'text-primary' : ''}`}
                  >
                    {formatTimer(timerDisplaySeconds)}
                  </p>
                  {timer.status === 'complete' ? (
                    <p className="font-medium text-primary">Timer complete</p>
                  ) : (
                    <div className="flex flex-wrap justify-center gap-2">
                      {timer.status === 'idle' ? (
                        <Button onClick={props.onStart}>
                          <PlayIcon className="mr-1.5 size-4" /> Start timer
                        </Button>
                      ) : timer.status === 'running' ? (
                        <Button onClick={props.onPause}>
                          <PauseIcon className="mr-1.5 size-4" /> Pause
                        </Button>
                      ) : (
                        <Button onClick={props.onResume}>
                          <PlayIcon className="mr-1.5 size-4" /> Resume
                        </Button>
                      )}
                      <Button variant="outline" onClick={props.onReset}>
                        <RotateCcwIcon className="mr-1.5 size-4" /> Reset
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                No timer set for this step.
              </p>
            )}
          </>
        )}
      </main>
      {!completed ? (
        <footer className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-3xl justify-between gap-3">
            <Button
              variant="outline"
              onClick={props.onPrevious}
              disabled={stepIndex === 0}
            >
              <ArrowLeftIcon className="mr-1.5 size-4" /> Previous
            </Button>
            {stepIndex === stepCount - 1 ? (
              <Button onClick={props.onComplete}>
                Complete <CheckCircle2Icon className="ml-1.5 size-4" />
              </Button>
            ) : (
              <Button onClick={props.onNext}>
                Next <ArrowRightIcon className="ml-1.5 size-4" />
              </Button>
            )}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
