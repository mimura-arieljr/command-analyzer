import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorCode } from '@ca/core/types';
import { analyze, checkSecret } from '../src/api';
import { App } from '../src/App';
import { FIND_XARGS, findXargs, rulesOnlyResult } from './fixtures';

vi.mock('../src/api', () => ({
  checkSecret: vi.fn(),
  analyze: vi.fn(),
  sha256Hex: vi.fn(),
}));

export const FORM_LABEL = 'Paste a shell command';
const HEADLINE = findXargs().headline;

async function unlock() {
  vi.mocked(checkSecret).mockResolvedValue('ok');
  const view = render(<App />);
  fireEvent.change(screen.getByLabelText(/secret/i), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByLabelText(FORM_LABEL);
  return view;
}

function analyzeText(text: string) {
  fireEvent.change(screen.getByLabelText(FORM_LABEL), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
}

beforeEach(() => {
  vi.mocked(checkSecret).mockReset();
  vi.mocked(analyze).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('unlock', () => {
  it('centres the unlock card with a gate layout, and drops it once unlocked', async () => {
    vi.mocked(checkSecret).mockResolvedValue('ok');
    const { container } = render(<App />);
    expect(container.querySelector('.wrap')?.classList.contains('wrap-gate')).toBe(true);
    fireEvent.change(screen.getByLabelText(/secret/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByLabelText(FORM_LABEL);
    expect(container.querySelector('.wrap')?.classList.contains('wrap-gate')).toBe(false);
  });

  it('a right secret reveals the form', async () => {
    await unlock();
    expect(checkSecret).toHaveBeenCalledWith('pw');
    expect(screen.getByRole('heading', { name: 'Command Analyzer' })).toBeTruthy();
    expect(screen.queryByLabelText(/secret/i)).toBeNull();
  });
});

describe('analysis', () => {
  it('sends the command and shows the result', async () => {
    vi.mocked(analyze).mockResolvedValue({ ok: true, analysis: findXargs() });
    await unlock();
    analyzeText('rm -rf build');
    expect(await screen.findByText(HEADLINE)).toBeTruthy();
    expect(analyze).toHaveBeenCalledWith('rm -rf build', undefined, 'pw');
  });

  it('Clear empties the text and the result', async () => {
    vi.mocked(analyze).mockResolvedValue({ ok: true, analysis: findXargs() });
    await unlock();
    analyzeText('rm -rf build');
    await screen.findByText(HEADLINE);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText(FORM_LABEL) as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(HEADLINE)).toBeNull();
  });
});

describe('results and the command box', () => {
  it('hovering a glossary row outlines it in the command', async () => {
    vi.mocked(analyze).mockResolvedValue({ ok: true, analysis: findXargs() });
    await unlock();
    analyzeText(FIND_XARGS);
    await screen.findByText(HEADLINE);
    const row = [...document.querySelectorAll('.gl .ln')].find((r) => r.querySelector('code')?.textContent === 'rm')!;
    fireEvent.mouseEnter(row);
    const marked = [...document.querySelectorAll('.cmdview .hl')].map((e) => e.textContent).join('');
    expect(marked).toBe('rm');
    fireEvent.mouseLeave(row);
    expect(document.querySelector('.cmdview .hl')).toBeNull();
  });

  it('Retry runs the same command and shell again', async () => {
    vi.mocked(analyze).mockResolvedValue({ ok: true, analysis: rulesOnlyResult() });
    await unlock();
    fireEvent.change(screen.getByLabelText('Shell'), { target: { value: 'zsh' } });
    analyzeText(FIND_XARGS);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    expect(vi.mocked(analyze).mock.calls[1]).toEqual([FIND_XARGS, 'zsh', 'pw']);
  });
});

describe('motion in the app', () => {
  it('shows the wait panel, then the results', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }));
    vi.mocked(analyze).mockResolvedValue({ ok: true, analysis: findXargs() });
    await unlock();
    analyzeText('rm -rf build');
    expect(screen.getByRole('status').textContent).toContain('Working out the shell');
    expect(document.querySelector('.cmdview')?.textContent).toBe('rm -rf build');
    expect(await screen.findByText(HEADLINE, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('errors skip the wait panel', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }));
    vi.mocked(analyze).mockResolvedValue({ ok: false, error: 'throttled', message: 'x' });
    await unlock();
    analyzeText('ls');
    expect(await screen.findByText('Too many requests. Wait a moment and try again.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('errors', () => {
  it('each error code shows its fixed message', async () => {
    const cases: [ErrorCode, string][] = [
      ['too_long', 'Too long (limit 5,000 characters).'],
      ['bad_output', "Couldn't analyse that. Try again."],
      ['failed', "Couldn't analyse that. Try again."],
      ['throttled', 'Too many requests. Wait a moment and try again.'],
      ['empty', 'Paste a command to analyze.'],
      ['bad_request', 'That request was not valid.'],
    ];
    for (const [error, message] of cases) {
      vi.mocked(analyze).mockResolvedValue({ ok: false, error, message: 'server words' });
      const view = await unlock();
      analyzeText('ls');
      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.queryByText('server words')).toBeNull();
      view.unmount();
    }
  });

  it('unauthorized sends the user back to the unlock box', async () => {
    vi.mocked(analyze).mockResolvedValue({ ok: false, error: 'unauthorized', message: 'nope' });
    await unlock();
    analyzeText('ls');
    expect(await screen.findByText('Wrong or missing secret.')).toBeTruthy();
    expect(screen.queryByLabelText(FORM_LABEL)).toBeNull();
  });
});

describe('storage and theme', () => {
  it('never calls localStorage.setItem', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.mocked(analyze).mockResolvedValue({ ok: true, analysis: findXargs() });
    await unlock();
    analyzeText('ls');
    await screen.findByText(HEADLINE);
    fireEvent.click(screen.getByRole('button', { name: /mode/i }));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('the page title moves into the unlock card and returns to the header after unlocking', async () => {
    vi.mocked(checkSecret).mockResolvedValue('ok');
    render(<App />);
    expect(document.querySelector('header h1')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Command Analyzer' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/secret/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByLabelText(FORM_LABEL);
    expect(document.querySelector('header h1')?.textContent).toBe('Command Analyzer');
  });

  it('theme toggle switches data-theme', async () => {
    render(<App />);
    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    await waitFor(() => expect(root.getAttribute('data-theme')).toBe('light'));
  });
});
