import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ErrorCode, FinalAnalysis } from '@ca/core/types';
import { Mark } from './Mark';
import { CommandForm } from './CommandForm';
import { CommandStrip } from './CommandStrip';
import { bentoAreas } from './layout';
import { ResultView, resultCards } from './ResultView';
import { useScan } from './motion';
import { colourSpans, wordSpans, type Range } from './tokens';
import { WaitPanel } from './WaitPanel';
import { UnlockGate } from './UnlockGate';
import { useAnalyzer } from './useAnalyzer';

type Theme = 'dark' | 'light';

const ERROR_TEXT: Record<Exclude<ErrorCode, 'unauthorized'>, string> = {
  empty: 'Paste a command to analyze.',
  too_long: 'Too long (limit 5,000 characters).',
  bad_request: 'That request was not valid.',
  throttled: 'Too many requests. Wait a moment and try again.',
  bad_output: "Couldn't analyse that. Try again.",
  failed: "Couldn't analyse that. Try again.",
};

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {theme === 'dark' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      )}
    </svg>
  );
}

function initialTheme(): Theme {
  const light =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return light ? 'light' : 'dark';
}

function Workspace({ secret, onUnauthorized }: { secret: string; onUnauthorized: () => void }) {
  const { status, result, error, command, run, retry, clear } = useAnalyzer(secret);
  const [highlight, setHighlight] = useState<Range[]>([]);
  const onHighlight = useCallback((r: Range[]) => setHighlight(r), []);

  // A new run or a cleared page drops any outline.
  useEffect(() => setHighlight([]), [status]);

  // The wait panel stays up until it has finished ticking, even when the answer is fast.
  const [revealed, setRevealed] = useState<FinalAnalysis | null>(null);
  const waiting = status === 'loading' || (status === 'done' && result !== null && result !== revealed);
  const onFinished = useCallback(() => setRevealed(result), [result]);
  const [waitStep, setWaitStep] = useState(0);
  const wordCount = command ? wordSpans(command).length : 0;
  const scanIndex = useScan(waiting && waitStep === 1, wordCount);

  useEffect(() => {
    if (error === 'unauthorized') onUnauthorized();
  }, [error, onUnauthorized]);

  const view = status === 'done' && result && !waiting ? result : null;
  const cards = view ? resultCards(view) : { does: false, risk: false, parts: false, steps: false };
  const areas = bentoAreas(cards);
  const formRef = useRef<HTMLFormElement>(null);
  const stripSpans = useMemo(() => (view && command ? colourSpans(command, view) : []), [view, command]);

  return (
    <>
      <div className="workspace" style={{ '--areas': areas.wide, '--areas-narrow': areas.narrow } as CSSProperties}>
        <CommandForm
          formRef={formRef}
          onAnalyze={run}
          onClear={clear}
          busy={waiting}
          result={view}
          analyzed={command}
          highlight={highlight}
          scanIndex={scanIndex}
        />
        {status === 'idle' && (
          <div className="placeholder hazard-slot" aria-hidden="true">
            <p>The verdict appears here, then what the command does, what could go wrong, its parts and each step.</p>
          </div>
        )}
        {waiting && <WaitPanel done={status === 'done'} onFinished={onFinished} onStep={setWaitStep} />}
        {status === 'error' && error && error !== 'unauthorized' && (
          <div className="card hazard-slot error-card">
            <p className="error" role="alert">
              {ERROR_TEXT[error]}
            </p>
          </div>
        )}
        {view && <ResultView analysis={view} command={command ?? ''} onHighlight={onHighlight} onRetry={retry} />}
      </div>
      {view && view.is_command && command && (
        <CommandStrip target={formRef} text={command} spans={stripSpans} highlight={highlight} />
      )}
    </>
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // The secret lives in React state only.
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className={secret === null ? 'wrap wrap-gate' : 'wrap'}>
      <header>
        {secret !== null && (
          <h1>
            <Mark />
            <span>Command Analyzer</span>
          </h1>
        )}
        <button
          className="theme"
          type="button"
          aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <ThemeIcon theme={theme} />
        </button>
      </header>
      {secret === null ? (
        <UnlockGate
          notice={notice}
          onUnlock={(s) => {
            setNotice('');
            setSecret(s);
          }}
        />
      ) : (
        <Workspace
          secret={secret}
          onUnauthorized={() => {
            setNotice('Wrong or missing secret.');
            setSecret(null);
          }}
        />
      )}
    </div>
  );
}
