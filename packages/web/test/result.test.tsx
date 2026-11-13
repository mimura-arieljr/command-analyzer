import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinalAnalysis } from '@ca/core/types';
import { ResultView } from '../src/ResultView';
import { FIND_XARGS, finding, findXargs, notACommand, rulesOnlyResult } from './fixtures';

function show(analysis: FinalAnalysis = findXargs(), command = FIND_XARGS) {
  const onHighlight = vi.fn();
  const onRetry = vi.fn();
  const view = render(<ResultView analysis={analysis} command={command} onHighlight={onHighlight} onRetry={onRetry} />);
  return { ...view, onHighlight, onRetry };
}

const rmAt = FIND_XARGS.indexOf(' rm ') + 1;

afterEach(() => cleanup());

describe('verdict', () => {
  it('shows the verdict headline and level first', () => {
    const { container } = show();
    const first = container.firstElementChild as HTMLElement;
    expect(first.textContent).toContain('Risk: high');
    expect(first.textContent).toContain(findXargs().headline);
  });

  it('shows a pill for every area and cards only for areas with findings', () => {
    const { container } = show();
    const pills = [...container.querySelectorAll('.areas .area')].map((e) => e.textContent);
    expect(pills).toEqual([
      expect.stringContaining('Data loss'),
      expect.stringContaining('System changes'),
      expect.stringContaining('Network'),
      expect.stringContaining('Elevated rights'),
      expect.stringContaining('Hidden behaviour'),
    ]);
    const cards = [...container.querySelectorAll('.risk-card h2')].map((e) => e.textContent);
    expect(cards).toEqual(['Data loss']);
  });

  it('orders risk cards by level', () => {
    const a = findXargs();
    a.risks.network = { level: 'high', findings: [finding({ reason: 'Downloads.', snippet: '' })] };
    a.risks.data_loss.level = 'medium';
    const { container } = show(a);
    const cards = [...container.querySelectorAll('.risk-card h2')].map((e) => e.textContent);
    expect(cards).toEqual(['Network', 'Data loss']);
  });

  it('labels certainty, source, depends on and check it', () => {
    show();
    expect(screen.getByText('Certain')).toBeTruthy();
    expect(screen.getByText('Possible')).toBeTruthy();
    expect(screen.getByText('Rule check')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('Depends on:')).toBeTruthy();
    expect(screen.getByText('Check it:')).toBeTruthy();
  });

  it('renders model text as plain text, not HTML', () => {
    const { container } = show(findXargs({ headline: '<b>bold</b>' }));
    expect(container.querySelector('.banner b')).toBeNull();
    expect(screen.getByText('<b>bold</b>')).toBeTruthy();
  });
});

describe('what it does', () => {
  it('shows the shell and confidence chips and the summary', () => {
    show();
    expect(screen.getByText('bash')).toBeTruthy();
    expect(screen.getByText('Confidence: high')).toBeTruthy();
    expect(screen.getByText(findXargs().what_it_does)).toBeTruthy();
  });

  it('shows the shell note when there is one', () => {
    const a = findXargs();
    a.shell.note = 'Also valid PowerShell.';
    show(a);
    expect(screen.getByText('Also valid PowerShell.')).toBeTruthy();
  });
});

describe('glossary', () => {
  it('tags glossary rows by type', () => {
    const { container } = show();
    const tags = [...container.querySelectorAll('.gl .ty')].map((e) => e.textContent);
    expect(tags.filter((t) => t === 'Command')).toHaveLength(3);
    expect(tags.filter((t) => t === 'Flag')).toHaveLength(3);
    expect(tags.filter((t) => t === 'Symbol')).toHaveLength(1);
  });

  it('nests flags under their command', () => {
    const { container } = show();
    const rmItem = [...container.querySelectorAll('.gl > li')].find((li) => li.querySelector('.ln code')?.textContent === 'rm');
    expect(rmItem?.querySelector(':scope > ul .ln code')?.textContent).toBe('-f');
  });

  it('shows an alias note', () => {
    const a = findXargs();
    a.glossary.commands[2].alias_note = 'In PowerShell, rm is an alias for Remove-Item.';
    show(a);
    expect(screen.getByText('In PowerShell, rm is an alias for Remove-Item.')).toBeTruthy();
  });

  it('hovering a glossary row reports its ranges', () => {
    const { container, onHighlight } = show();
    const row = [...container.querySelectorAll('.gl .ln')].find((r) => r.querySelector('code')?.textContent === 'rm')!;
    fireEvent.mouseEnter(row);
    expect(onHighlight).toHaveBeenLastCalledWith([[rmAt, rmAt + 2]]);
    fireEvent.mouseLeave(row);
    expect(onHighlight).toHaveBeenLastCalledWith([]);
  });

  it('focusing a row highlights too', () => {
    const { container, onHighlight } = show();
    const row = [...container.querySelectorAll('.gl .ln')].find((r) => r.querySelector('code')?.textContent === '|')! as HTMLElement;
    fireEvent.focus(row);
    const at = FIND_XARGS.indexOf('|');
    expect(onHighlight).toHaveBeenLastCalledWith([[at, at + 1]]);
    fireEvent.blur(row);
    expect(onHighlight).toHaveBeenLastCalledWith([]);
  });
});

describe('steps', () => {
  it('numbers steps and leaves joiners unnumbered', () => {
    const { container } = show();
    const nums = [...container.querySelectorAll('.steps tbody tr')].map((tr) => tr.querySelector('td')?.textContent);
    expect(nums).toEqual(['1', '', '2']);
    expect(container.querySelector('.steps tbody tr.joiner')).not.toBeNull();
  });

  it('hovering a step reports its range', () => {
    const { container, onHighlight } = show();
    const rows = container.querySelectorAll('.steps tbody tr');
    fireEvent.mouseEnter(rows[2]);
    const at = FIND_XARGS.indexOf('xargs rm -f');
    expect(onHighlight).toHaveBeenLastCalledWith([[at, at + 'xargs rm -f'.length]]);
  });
});

describe('findings hover', () => {
  it('a snippet not in the command highlights nothing', () => {
    const a = findXargs();
    a.risks.data_loss.findings = [finding({ snippet: 'not in there' })];
    const { container, onHighlight } = show(a);
    fireEvent.mouseEnter(container.querySelector('.finding')!);
    expect(onHighlight).toHaveBeenLastCalledWith([]);
  });

  it('a finding snippet highlights its place', () => {
    const { container, onHighlight } = show();
    fireEvent.mouseEnter(container.querySelector('.finding')!);
    const at = FIND_XARGS.indexOf('xargs rm -f');
    expect(onHighlight).toHaveBeenLastCalledWith([[at, at + 11]]);
  });
});

describe('special results', () => {
  it('not a command shows only the message', () => {
    const { container } = show(notACommand(), 'hello there');
    expect(screen.getByText('This looks like a sentence, not a command.')).toBeTruthy();
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('rules-only result shows the note and Retry', () => {
    const { container, onRetry } = show(rulesOnlyResult());
    expect(screen.getByText(/explanation isn't available right now/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(container.querySelector('.gl')).toBeNull();
    expect(container.querySelector('.steps')).toBeNull();
    expect(container.querySelector('.banner')).not.toBeNull();
  });

  it('no improvements section exists', () => {
    show();
    expect(screen.queryByText(/Improvements/i)).toBeNull();
  });

  it('a clean result says so', () => {
    const a = findXargs();
    for (const k of Object.keys(a.risks) as (keyof typeof a.risks)[]) a.risks[k] = { level: 'none', findings: [] };
    a.overall = 'none';
    const { container } = show(a);
    expect(within(container.querySelector('.banner') as HTMLElement).getByText('Risk: none')).toBeTruthy();
    expect(container.querySelector('.risk-card')).toBeNull();
  });
});
