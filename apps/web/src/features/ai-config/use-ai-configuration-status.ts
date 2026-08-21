import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchAiConfigurationStatus,
  type AiConfiguration,
} from './ai-config-api.ts';

interface UseAiConfigurationStatusResult {
  configuration: AiConfiguration | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAiConfigurationStatus(): UseAiConfigurationStatusResult {
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestId.current += 1;
    const currentRequestId = requestId.current;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const nextConfiguration = await fetchAiConfigurationStatus(
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        requestId.current === currentRequestId
      ) {
        setConfiguration(nextConfiguration);
      }
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        requestId.current === currentRequestId
      ) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load AI settings. Please try again.',
        );
      }
    } finally {
      if (
        !controller.signal.aborted &&
        requestId.current === currentRequestId
      ) {
        setIsLoading(false);
      }
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [refresh]);

  return {
    configuration,
    isLoading,
    error,
    refresh,
  };
}
