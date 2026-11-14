import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import * as Select from '@radix-ui/react-select';
import { MAX_COMMAND_CHARS, SHELLS, type FinalAnalysis, type Shell } from '@ca/core/types';
import { CommandView } from './CommandView';
import { colourSpans, wordSpans, type Range } from './tokens';

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
  formRef?: Ref<HTMLFormElement>;
}

// What the closed picker shows.
function shownChoice(choice: Choice, result: FinalAnalysis | null): string {
  if (choice !== 'auto') return SHELL_LABEL[choice];
  if (!result || result.shell.name === 'unknown') return 'Auto-detect';
  return `${SHELL_LABEL[result.shell.name]} (auto)`;
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function ShellOption({ value, text, hint }: { value: Choice; text: string; hint?: string }) {
  return (
    <Select.Item value={value} className="shell-item">
      <span className="shell-item-text">
        <Select.ItemText>{text}</Select.ItemText>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <Select.ItemIndicator className="tick">
        <Check />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

export function CommandForm({ onAnalyze, onClear, busy, result, analyzed, highlight, scanIndex, formRef }: Props) {
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
      ref={formRef}
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
          aria-describedby="command-hint"
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
        <Select.Root
          value={choice}
          disabled={busy}
          onValueChange={(v) => {
            const next = v as Choice;
            setChoice(next);
            // While editing, the pick applies to the next Analyze, not to the old command.
            if (showView && result && analyzed !== null) run(analyzed, next);
          }}
        >
          <Select.Trigger className="shell-trigger" aria-label="Shell">
            <span className="k">Shell</span>
            <Select.Value>{shownChoice(choice, result)}</Select.Value>
            <Select.Icon className="chev">
              <Chevron />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="shell-menu" position="popper" side="bottom" align="end" sideOffset={6}>
              <Select.Viewport>
                <ShellOption
                  value="auto"
                  text="Auto-detect"
                  hint={
                    result && result.shell.name !== 'unknown'
                      ? `Detected ${SHELL_LABEL[result.shell.name]}, ${result.shell.confidence} confidence`
                      : 'Works out the shell from the command'
                  }
                />
                <Select.Separator className="shell-sep" />
                {SHELLS.map((sh) => (
                  <ShellOption key={sh} value={sh} text={SHELL_LABEL[sh]} />
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>
      {tooLong && (
        <p className="too-long" role="alert">
          Too long: the limit is 5,000 characters.
        </p>
      )}
    </form>
  );
}
