import { describe, expect, it } from 'vitest';
import { allTokenRanges, colourSpans, findInOrder, symbolRanges, wordSpans } from '../src/tokens';
import { FIND_XARGS, findXargs } from './fixtures';

describe('findInOrder', () => {
  it('finds repeated snippets in order', () => {
    expect(findInOrder('rm a; rm b', ['rm a', 'rm b'])).toEqual([
      [0, 4],
      [6, 10],
    ]);
    expect(findInOrder('rm x; rm x', ['rm x', 'rm x'])).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it('returns null for a missing or empty snippet', () => {
    expect(findInOrder('ls -la', ['rm -rf', ''])).toEqual([null, null]);
  });

  it('falls back to searching from the start', () => {
    expect(findInOrder('a | b', ['b', 'a'])).toEqual([
      [4, 5],
      [0, 1],
    ]);
  });
});

describe('allTokenRanges', () => {
  it('finds every whole-token occurrence', () => {
    expect(allTokenRanges('rm -rf x; rm y', 'rm')).toEqual([
      [0, 2],
      [10, 12],
    ]);
  });

  it('ignores matches inside other words', () => {
    expect(allTokenRanges('farm', 'rm')).toEqual([]);
    expect(allTokenRanges('rm-thing', 'rm')).toEqual([]);
  });

  it('accepts shell punctuation as a boundary', () => {
    expect(allTokenRanges('(rm x)|grep', 'rm')).toEqual([[1, 3]]);
  });

  it('returns nothing for an empty token', () => {
    expect(allTokenRanges('abc', '')).toEqual([]);
  });
});

describe('colourSpans', () => {
  it('covers the text exactly once', () => {
    const spans = colourSpans(FIND_XARGS, findXargs());
    let at = 0;
    for (const s of spans) {
      expect(s.start).toBe(at);
      expect(s.end).toBeGreaterThan(s.start);
      at = s.end;
    }
    expect(at).toBe(FIND_XARGS.length);
  });

  it('marks commands, flags and symbols', () => {
    const spans = colourSpans(FIND_XARGS, findXargs());
    const kindOf = (t: string) => spans.find((s) => FIND_XARGS.slice(s.start, s.end) === t)?.kind;
    expect(kindOf('find')).toBe('command');
    expect(kindOf('rm')).toBe('command');
    expect(kindOf('-f')).toBe('flag');
    expect(kindOf('-name "*.log"')).toBe('flag');
    expect(kindOf('|')).toBe('symbol');
  });

  it('is all plain for an empty text', () => {
    expect(colourSpans('', findXargs())).toEqual([]);
  });
});

describe('wordSpans', () => {
  it('splits on whitespace', () => {
    expect(wordSpans(' ls  -la\nx')).toEqual([
      [1, 3],
      [5, 8],
      [9, 10],
    ]);
  });
});

describe('symbolRanges', () => {
  it('an empty token matches nothing (and returns)', () => {
    expect(symbolRanges('ls | wc', '')).toEqual([]);
  });

  it('an empty symbol from the model does not stop colouring', () => {
    const a = findXargs();
    a.glossary.symbols.push({ token: '', meaning: 'line break' });
    expect(colourSpans(FIND_XARGS, a).length).toBeGreaterThan(0);
  });
});
