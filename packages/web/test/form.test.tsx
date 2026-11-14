import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinalAnalysis } from '@ca/core/types';
import { CommandForm } from '../src/CommandForm';
import { FIND_XARGS, findXargs } from './fixtures';
import { pickShell, shellPicker } from './select';

const LABEL = 'Paste a shell command';

interface Over {
  result?: FinalAnalysis | null;
  analyzed?: string | null;
  busy?: boolean;
  highlight?: [number, number][];
  scanIndex?: number | null;
}

function setup(over: Over = {}) {
  const onAnalyze = vi.fn();
  const onClear = vi.fn();
  const props = {
    onAnalyze,
    onClear,
    busy: false,
    result: null,
    analyzed: null,
    highlight: [],
    scanIndex: null,
    ...over,
  };
  const view = render(<CommandForm {...props} />);
  const rerender = (next: Over) => view.rerender(<CommandForm {...props} {...next} />);
  return { onAnalyze, onClear, rerender };
}

function typeAndAnalyze(text: string) {
  fireEvent.change(screen.getByLabelText(LABEL), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
}

afterEach(() => cleanup());

describe('CommandForm', () => {
  it('shows a textarea first', () => {
    setup();
    expect(screen.getByLabelText(LABEL).tagName).toBe('TEXTAREA');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('Analyze sends the text with no shell on auto', () => {
    const { onAnalyze } = setup();
    typeAndAnalyze('ls -la');
    expect(onAnalyze).toHaveBeenCalledWith('ls -la', undefined);
  });

  it('Analyze sends the picked shell', () => {
    const { onAnalyze } = setup();
    pickShell('PowerShell');
    typeAndAnalyze('rm -r x');
    expect(onAnalyze).toHaveBeenCalledWith('rm -r x', 'powershell');
  });

  it('after a result shows the coloured view and an Edit button', () => {
    const { rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    rerender({ result: findXargs(), analyzed: FIND_XARGS });
    expect(screen.queryByRole('textbox')).toBeNull();
    const view = document.querySelector('.cmdview') as HTMLElement;
    expect(view.textContent).toBe(FIND_XARGS);
    expect(view.querySelector('.tok.command')?.textContent).toBe('find');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('Edit restores the textarea with the text', () => {
    const { rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    rerender({ result: findXargs(), analyzed: FIND_XARGS });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByLabelText(LABEL) as HTMLTextAreaElement;
    expect(box.value).toBe(FIND_XARGS);
    expect(document.activeElement).toBe(box);
  });

  it('shows the detected shell in the picker after a result', () => {
    const { rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    rerender({ result: findXargs(), analyzed: FIND_XARGS });
    expect(shellPicker().textContent).toContain('bash (auto)');
    fireEvent.keyDown(shellPicker(), { key: 'Enter' });
    const auto = screen.getByRole('option', { name: /Auto-detect/ });
    expect(auto.textContent).toContain('Detected bash, high confidence');
    expect(auto.getAttribute('data-state')).toBe('checked');
  });

  it('puts Analyze, Edit, Clear and the shell picker in one row', () => {
    const { rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    rerender({ result: findXargs(), analyzed: FIND_XARGS });
    const row = screen.getByRole('button', { name: 'Analyze' }).closest('.actions');
    for (const name of ['Edit', 'Clear']) expect(screen.getByRole('button', { name }).closest('.actions')).toBe(row);
    expect(shellPicker().closest('.actions')).toBe(row);
  });

  it('changing the shell after a result re-runs the analysis', () => {
    const { onAnalyze, rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    rerender({ result: findXargs(), analyzed: FIND_XARGS });
    pickShell('zsh');
    expect(onAnalyze).toHaveBeenLastCalledWith(FIND_XARGS, 'zsh');
  });

  it('changing the shell while editing does not re-run the old command', () => {
    const { onAnalyze, rerender } = setup();
    typeAndAnalyze('ls');
    rerender({ result: findXargs(), analyzed: 'ls' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'rm -rf build' } });
    pickShell('PowerShell');
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    const box = screen.getByLabelText(LABEL) as HTMLTextAreaElement;
    expect(box.value).toBe('rm -rf build');
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(onAnalyze).toHaveBeenLastCalledWith('rm -rf build', 'powershell');
  });

  it('changing the shell before a result does not run anything', () => {
    const { onAnalyze } = setup();
    pickShell('zsh');
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('while busy shows the command and marks the scanned word', () => {
    const { rerender } = setup();
    typeAndAnalyze('rm -rf build');
    rerender({ busy: true, scanIndex: 1 });
    const view = document.querySelector('.cmdview') as HTMLElement;
    expect(view.textContent).toBe('rm -rf build');
    expect(view.querySelector('.scan')?.textContent).toBe('-rf');
    expect((screen.getByRole('button', { name: 'Analyze' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('outlines highlighted ranges', () => {
    const { rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    const at = FIND_XARGS.indexOf(' rm ') + 1;
    rerender({ result: findXargs(), analyzed: FIND_XARGS, highlight: [[at, at + 2]] });
    const marked = [...document.querySelectorAll('.cmdview .hl')].map((e) => e.textContent).join('');
    expect(marked).toBe('rm');
  });

  it('marks only the outer edges of a highlight that spans several tokens', () => {
    const { rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    const at = FIND_XARGS.indexOf('xargs');
    rerender({ result: findXargs(), analyzed: FIND_XARGS, highlight: [[at, FIND_XARGS.length]] });
    const marked = [...document.querySelectorAll('.cmdview .hl')];
    expect(marked.length).toBeGreaterThan(2);
    expect(marked.map((e) => e.classList.contains('hl-start'))).toEqual(marked.map((_, i) => i === 0));
    expect(marked.map((e) => e.classList.contains('hl-end'))).toEqual(marked.map((_, i) => i === marked.length - 1));
  });

  it('Analyze is disabled for empty text and over 5,000 characters', () => {
    setup();
    const button = screen.getByRole('button', { name: 'Analyze' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'a'.repeat(5000) } });
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'a'.repeat(5001) } });
    expect(button.disabled).toBe(true);
  });

  it('shows no character counter, only a message once the text is too long', () => {
    setup();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'ls' } });
    expect(screen.queryByText(/characters/)).toBeNull();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'a'.repeat(5001) } });
    expect(screen.getByRole('alert').textContent).toBe('Too long: the limit is 5,000 characters.');
  });

  it('Clear empties the text and calls onClear', () => {
    const { onClear } = setup();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'ls' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText(LABEL) as HTMLTextAreaElement).value).toBe('');
    expect(onClear).toHaveBeenCalled();
  });
});
