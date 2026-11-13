import { describe, expect, it } from 'vitest';
import { afterPrivilege, commandWord, lex } from '../src/lex';

const values = (text: string, family: 'unix' | 'powershell' | 'cmd' = 'unix') =>
  lex(text, family).map((s) => s.words.map((w) => w.value));

describe('lex', () => {
  it('splits a pipeline', () => {
    const segs = lex('find . -name "*.log" | xargs rm -f', 'unix');
    expect(segs).toHaveLength(2);
    expect(segs[1].joinerBefore).toBe('|');
    expect(segs[0].joinerAfter).toBe('|');
    expect(segs[1].words[0].value).toBe('xargs');
    expect(segs[0].words.map((w) => w.value)).toEqual(['find', '.', '-name', '*.log']);
  });

  it('splits on && || ; and newlines', () => {
    expect(values('a && b || c; d\ne')).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('keeps quoted text as one word', () => {
    const segs = lex('echo "rm -rf /"', 'unix');
    expect(segs).toHaveLength(1);
    expect(segs[0].words).toHaveLength(2);
    expect(segs[0].words[1].value).toBe('rm -rf /');
    expect(segs[0].words[1].quoted).toBe(true);
  });

  it('records redirects', () => {
    const segs = lex('npm run build > out.log 2>&1', 'unix');
    expect(segs).toHaveLength(1);
    expect(segs[0].redirects).toEqual([
      { op: '>', target: 'out.log' },
      { op: '2>&1', target: '&1' },
    ]);
    expect(segs[0].words.map((w) => w.value)).toEqual(['npm', 'run', 'build']);
  });

  it('records append and attached redirects', () => {
    const segs = lex('echo hi >>log.txt', 'unix');
    expect(segs[0].redirects).toEqual([{ op: '>>', target: 'log.txt' }]);
  });

  it('joins unix continuations', () => {
    expect(values('rm -rf \\\n  build')).toEqual([['rm', '-rf', 'build']]);
  });

  it('joins PowerShell continuations', () => {
    expect(values('Remove-Item `\n -Recurse x', 'powershell')).toEqual([['Remove-Item', '-Recurse', 'x']]);
  });

  it('joins cmd continuations', () => {
    expect(values('del ^\n /s x', 'cmd')).toEqual([['del', '/s', 'x']]);
  });

  it('drops comments', () => {
    expect(values('ls # rm -rf /')).toEqual([['ls']]);
    expect(values('rem del /s x', 'cmd')).toEqual([]);
    expect(values(':: del /s x', 'cmd')).toEqual([]);
    expect(values('Get-Date <# Remove-Item x #>', 'powershell')).toEqual([['Get-Date']]);
  });

  it('keeps a hash inside a word', () => {
    expect(values('echo a#b')).toEqual([['echo', 'a#b']]);
  });

  it('lexes nested command text', () => {
    const nested = lex('bash -c "rm -rf /tmp/x"', 'unix').filter((s) => s.nested);
    expect(nested[0].words[0].value).toBe('rm');
    const sub = lex('echo $(curl x)', 'unix').filter((s) => s.nested);
    expect(sub[0].words.map((w) => w.value)).toEqual(['curl', 'x']);
    const tick = lex('echo `whoami`', 'unix').filter((s) => s.nested);
    expect(tick[0].words[0].value).toBe('whoami');
  });

  it('lexes PowerShell subexpressions and script blocks', () => {
    const nested = lex('iex (iwr https://x)', 'powershell').filter((s) => s.nested);
    expect(nested[0].words[0].value).toBe('iwr');
    const block = lex('Get-ChildItem | ForEach-Object { Remove-Item $_ }', 'powershell').filter((s) => s.nested);
    expect(block[0].words[0].value).toBe('Remove-Item');
  });

  it('lexes cmd /c text and powershell inside cmd', () => {
    const nested = lex('cmd /c "rd /s /q build"', 'cmd').filter((s) => s.nested);
    expect(nested[0].words.map((w) => w.value)).toEqual(['rd', '/s', '/q', 'build']);
    const ps = lex('powershell -Command "Remove-Item -Recurse x"', 'cmd').filter((s) => s.nested);
    expect(ps[0].family).toBe('powershell');
    expect(ps[0].words[0].value).toBe('Remove-Item');
  });

  it('word offsets point into the original', () => {
    const text = 'FOO=1 sudo rm -rf "$DIR/" | tee out.txt; echo $(ls -a) `pwd`';
    for (const seg of lex(text, 'unix')) {
      for (const w of seg.words) expect(text.slice(w.start, w.end)).toBe(w.raw);
      expect(text.slice(seg.start, seg.end)).toBe(seg.raw);
    }
  });

  it('segment raw excludes the joiner and surrounding space', () => {
    const segs = lex('find . | xargs rm -f', 'unix');
    expect(segs.map((s) => s.raw)).toEqual(['find .', 'xargs rm -f']);
  });

  it('removes quotes and escapes from values', () => {
    expect(values("echo 'a b' \"c\\\"d\" e\\ f")).toEqual([['echo', 'a b', 'c"d', 'e f']]);
  });

  it('handles PowerShell backtick escapes and single quotes', () => {
    expect(values("Write-Host 'it''s' \"a`\"b\"", 'powershell')).toEqual([['Write-Host', "it's", 'a"b']]);
  });
});

describe('commandWord', () => {
  it('skips assignments and env', () => {
    const [seg] = lex('FOO=1 env BAR=2 rm x', 'unix');
    expect(commandWord(seg, 'unix')).toEqual({ name: 'rm', index: 3 });
  });

  it('lower-cases PowerShell and cmd names', () => {
    const [seg] = lex('Remove-Item x', 'powershell');
    expect(commandWord(seg, 'powershell')).toEqual({ name: 'remove-item', index: 0 });
  });

  it('strips a path prefix', () => {
    const [seg] = lex('/bin/rm x', 'unix');
    expect(commandWord(seg, 'unix')?.name).toBe('rm');
  });

  it('returns null for an empty segment', () => {
    const [seg] = lex('FOO=1', 'unix');
    expect(commandWord(seg, 'unix')).toBeNull();
  });
});

describe('afterPrivilege', () => {
  it('strips sudo and its flags', () => {
    const [seg] = lex('sudo -u root rm -rf /', 'unix');
    expect(afterPrivilege(seg).words[0].value).toBe('rm');
  });

  it('leaves other segments alone', () => {
    const [seg] = lex('rm x', 'unix');
    expect(afterPrivilege(seg)).toBe(seg);
  });
});
