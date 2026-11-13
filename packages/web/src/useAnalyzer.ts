import { useCallback, useRef, useState } from 'react';
import type { ErrorCode, FinalAnalysis, Shell } from '@ca/core/types';
import { analyze } from './api';

type Status = 'idle' | 'loading' | 'done' | 'error';

export function useAnalyzer(secret: string) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<FinalAnalysis | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  // The command the current result belongs to.
  const [command, setCommand] = useState<string | null>(null);
  const lastShell = useRef<Shell | undefined>(undefined);
  // Refs so rapid calls see current values before React re-renders.
  const requestId = useRef(0);
  const loading = useRef(false);

  const run = useCallback(
    (text: string, shell?: Shell) => {
      if (loading.current) return;
      loading.current = true;
      const id = ++requestId.current;
      setStatus('loading');
      setResult(null);
      setError(null);
      setCommand(text);
      lastShell.current = shell;
      void analyze(text, shell, secret).then((res) => {
        if (id !== requestId.current) return;
        loading.current = false;
        if (res.ok) {
          setResult(res.analysis);
          setStatus('done');
        } else {
          setError(res.error);
          setStatus('error');
        }
      });
    },
    [secret],
  );

  const clear = useCallback(() => {
    requestId.current++;
    loading.current = false;
    setStatus('idle');
    setResult(null);
    setError(null);
    setCommand(null);
  }, []);

  // Runs the last command again with the same shell choice.
  const retry = useCallback(() => {
    if (command !== null) run(command, lastShell.current);
  }, [command, run]);

  return { status, result, error, command, run, retry, clear };
}
