import type { FinalAnalysis } from '@ca/core/types';

export type Range = [start: number, end: number];

export type SpanKind = 'command' | 'flag' | 'symbol' | 'plain';

export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
}

// Each needle searched from the end of the previous match; on a miss, from the start.
export function findInOrder(text: string, needles: string[]): (Range | null)[] {
  let cursor = 0;
  return needles.map((n) => {
    if (!n) return null;
    let at = text.indexOf(n, cursor);
    if (at < 0) at = text.indexOf(n);
    if (at < 0) return null;
    cursor = at + n.length;
    return [at, at + n.length];
  });
}

const BOUNDARY = /[\s|&;()<>"'{}]/;
const isBoundary = (c: string | undefined) => c === undefined || BOUNDARY.test(c);

// Every occurrence of `token` that stands on its own (not inside a longer word).
export function allTokenRanges(text: string, token: string): Range[] {
  if (!token) return [];
  const out: Range[] = [];
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
    const end = at + token.length;
    if (isBoundary(text[at - 1]) && isBoundary(text[end])) out.push([at, end]);
  }
  return out;
}

// Symbols such as * or 2>&1 can sit inside a word, so they match anywhere.
export function symbolRanges(text: string, token: string): Range[] {
  if (/[A-Za-z0-9]/.test(token)) return allTokenRanges(text, token);
  const out: Range[] = [];
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + token.length)) {
    out.push([at, at + token.length]);
  }
  return out;
}

// The command split into coloured spans, covering the text exactly once.
// - Earlier kinds win on overlap: command, then flag, then symbol; longer tokens first within a kind.
export function colourSpans(text: string, analysis: FinalAnalysis): Span[] {
  const claimed: Span[] = [];
  const claim = (kind: SpanKind, tokens: string[], find: (t: string) => Range[]) => {
    for (const t of [...new Set(tokens)].sort((a, b) => b.length - a.length)) {
      for (const [start, end] of find(t)) {
        if (!claimed.some((c) => start < c.end && end > c.start)) claimed.push({ start, end, kind });
      }
    }
  };
  const { commands, symbols } = analysis.glossary;
  claim('command', commands.map((c) => c.name), (t) => allTokenRanges(text, t));
  claim('flag', commands.flatMap((c) => c.flags.map((f) => f.token)), (t) => allTokenRanges(text, t));
  claim('symbol', symbols.map((s) => s.token), (t) => symbolRanges(text, t));
  claimed.sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  let at = 0;
  for (const c of claimed) {
    if (c.start > at) out.push({ start: at, end: c.start, kind: 'plain' });
    out.push(c);
    at = c.end;
  }
  if (at < text.length) out.push({ start: at, end: text.length, kind: 'plain' });
  return out;
}

// Whitespace-separated words, for the scan while waiting.
export function wordSpans(text: string): Range[] {
  return [...text.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length] as Range);
}
