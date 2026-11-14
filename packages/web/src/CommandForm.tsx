import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_COMMAND_CHARS, SHELLS, type FinalAnalysis, type Shell } from '@ca/core/types';
import { CommandView } from './CommandView';
import { colourSpans, wordSpans, type Range } from './tokens';

const nf = new Intl.NumberFormat('en-US');

export const SHELL_LABEL: Record<Shell, string> = {
  bash: 'bash',
  zsh: 'zsh',
  sh: 'sh',
  powershell: 'PowerShell',
  cmd: 'cmd',
};

type Choice = Shell | 'auto';

interface Props {
  onAnalyze: (command: string, shell?: Shell) => void;
  onClear: () => void;
  busy: boolean;
  result: FinalAnalysis | null;
  // The command the result belongs to.
  analyzed: string | null;
  highlight: Range[];
  scanIndex: number | null;
}

function autoLabel(result: FinalAnalysis | null): string {
  if (!result || result.shell.name === 'unknown') return 'Auto-detect';
  return `${SHELL_LABEL[result.shell.name]} (detected, ${result.shell.confidence})`;
}

export function CommandForm({ onAnalyze, onClear, busy, result, analyzed, highlight, scanIndex }: Props) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(true);
  const [choice, setChoice] = useState<Choice>('auto');
  const box = useRef<HTMLTextAreaElement>(null);
  const focusBox = useRef(false);

  const tooLong = text.length > MAX_COMMAND_CHARS;
  const disabled = busy || tooLong || text.trim() === '';
  const shown = busy ? text : (analyzed ?? text);
  const showView = busy || (!editing && result !== null);
  const words = useMemo(() => wordSpans(shown), [shown]);
  const spans = useMemo(() => (result && !busy ? colourSpans(shown, result) : []), [shown, result, busy]);

  useEffect(() => {
    if (!showView && focusBox.current) {
      focusBox.current = false;
      box.current?.focus();
    }
  }, [showView]);

  const shellOf = (c: Choice) => (c === 'auto' ? undefined : c);

  function run(command: string, c: Choice) {
    setEditing(false);
    onAnalyze(command, shellOf(c));
  }

  function edit() {
    if (analyzed !== null) setText(analyzed);
    focusBox.current = true;
    setEditing(true);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) run(text, choice);
      }}
    >
      <label htmlFor="command">Paste a shell command</label>
      <p className="hint" id="command-hint">
        bash, zsh, sh, PowerShell or cmd. One command or a short block.
      </p>
      {showView ? (
        <CommandView
          text={shown}
          spans={spans}
          highlight={busy ? [] : highlight}
          scanIndex={busy ? scanIndex : null}
          words={words}
          onEdit={busy ? undefined : edit}
        />
      ) : (
        <textarea
          id="command"
          ref={box}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-describedby="command-hint command-count"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <div className="actions">
        <button className="btn-primary" type="submit" disabled={disabled}>
          Analyze
        </button>
        {showView && !busy && (
          <button className="btn-ghost" type="button" onClick={edit}>
            Edit
          </button>
        )}
        <button
          className="btn-ghost"
          type="button"
          onClick={() => {
            setText('');
            setEditing(true);
            onClear();
          }}
        >
          Clear
        </button>
        <span className="shell-pick">
          <select
            aria-label="Shell"
            value={choice}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as Choice;
              setChoice(next);
              // While editing, the pick applies to the next Analyze, not to the old command.
              if (showView && result && analyzed !== null) run(analyzed, next);
            }}
          >
            <option value="auto">{autoLabel(result)}</option>
            {SHELLS.map((s) => (
              <option key={s} value={s}>
                {SHELL_LABEL[s]}
              </option>
            ))}
          </select>
        </span>
        <span className={tooLong ? 'counter over' : 'counter'} id="command-count">
          {nf.format(text.length)} / {nf.format(MAX_COMMAND_CHARS)} characters
        </span>
      </div>
    </form>
  );
}
