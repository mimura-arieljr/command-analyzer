import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinalAnalysis } from '@ca/core/types';
import { CommandForm } from '../src/CommandForm';
import { FIND_XARGS, findXargs } from './fixtures';

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
    fireEvent.change(screen.getByLabelText('Shell'), { target: { value: 'powershell' } });
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
    const auto = screen.getByRole('option', { name: 'bash (detected, high)' }) as HTMLOptionElement;
    expect(auto.selected).toBe(true);
  });

  it('changing the shell after a result re-runs the analysis', () => {
    const { onAnalyze, rerender } = setup();
    typeAndAnalyze(FIND_XARGS);
    rerender({ result: findXargs(), analyzed: FIND_XARGS });
    fireEvent.change(screen.getByLabelText('Shell'), { target: { value: 'zsh' } });
    expect(onAnalyze).toHaveBeenLastCalledWith(FIND_XARGS, 'zsh');
  });

  it('changing the shell before a result does not run anything', () => {
    const { onAnalyze } = setup();
    fireEvent.change(screen.getByLabelText('Shell'), { target: { value: 'zsh' } });
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

  it('Analyze is disabled for empty text and over 5,000 characters', () => {
    setup();
    const button = screen.getByRole('button', { name: 'Analyze' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('0 / 5,000 characters')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'a'.repeat(5000) } });
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'a'.repeat(5001) } });
    expect(button.disabled).toBe(true);
    expect(screen.getByText('5,001 / 5,000 characters')).toBeTruthy();
  });

  it('Clear empties the text and calls onClear', () => {
    const { onClear } = setup();
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'ls' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText(LABEL) as HTMLTextAreaElement).value).toBe('');
    expect(onClear).toHaveBeenCalled();
  });
});
