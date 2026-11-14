import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules';
import type { Shell } from '../src/types';

// Auto mode is what the page sends by default, so most cases run with no shell.
const ids = (text: string, shell?: Shell) => runRules(text, shell).map((h) => h.id);
const levelOf = (text: string, id: string, shell?: Shell) => runRules(text, shell).find((h) => h.id === id)?.level;
const dataLoss = (text: string, shell?: Shell) => runRules(text, shell).filter((h) => h.area === 'data_loss');

describe('deletes behind wrappers and control flow', () => {
  it.each([
    ['if exist build rd /s /q build', 'cmd'],
    ['if not exist x\\keep del /s /q build', 'cmd'],
    ['if /i "%A%"=="y" rd /s /q build', 'cmd'],
    ['timeout 10 rm -rf build', 'bash'],
    ['timeout -s KILL 5 rm -rf build', 'bash'],
    ['watch -n1 rm -f x', 'bash'],
    ['ionice -c3 rm -rf build', 'bash'],
    ['caffeinate -i rm -rf build', 'bash'],
    ['bash -c "bash -c \\"rm -rf x\\""', 'bash'],
    ['ssh h "sudo bash -c \\"rm -rf /x\\""', 'bash'],
    ['su -c "rm -rf /x"', 'bash'],
    ['su root -c "rm -rf /x"', 'bash'],
  ] as const)('%s gives a high delete (auto and %s)', (text, shell) => {
    for (const s of [undefined, shell]) {
      expect(dataLoss(text, s).some((h) => h.level === 'high')).toBe(true);
    }
  });

  it('cmd for loops delete every file they visit', () => {
    expect(levelOf('for /r %f in (*.log) do del "%f"', 'delete-recursive')).toBe('high');
    expect(levelOf('for /r %f in (*.log) do del "%f"', 'delete-recursive', 'cmd')).toBe('high');
  });

  it.each([
    'ls | xargs sudo rm',
    'ls | xargs -0 sudo -u bob rm -f',
    'find . -exec sudo rm {} +',
    'find . -name x -print -exec echo {} \\; -exec rm {} \\;',
    "find . -exec sh -c 'rm \"$1\"' _ {} \\;",
  ])('%s is a high delete', (text) => {
    expect(dataLoss(text, 'bash').some((h) => h.level === 'high')).toBe(true);
    expect(dataLoss(text).some((h) => h.level === 'high')).toBe(true);
  });

  it('snippets of escaped nested deletes are exact input text', () => {
    const text = 'bash -c "bash -c \\"rm -rf x\\""';
    for (const h of runRules(text)) expect(text).toContain(h.snippet);
  });

  it('cmd if with no command stays quiet', () => {
    expect(ids('if exist build echo yes')).toEqual([]);
  });
});

describe('null devices in auto mode', () => {
  it.each(['ls 2>/dev/null', 'ls > /dev/null', 'ls &>/dev/null', 'dir > nul 2>&1', 'dir > NUL', 'echo x > $null', 'echo x > $NULL'])(
    '%s gives nothing',
    (text) => {
      expect(ids(text)).toEqual([]);
    },
  );

  it('a null redirect followed by ; gives no overwrite', () => {
    expect(ids('ls 2>/dev/null; rm -rf build')).not.toContain('overwrite-redirect');
  });

  it('a real file is still an overwrite', () => {
    expect(ids('ls > out.txt')).toContain('overwrite-redirect');
  });
});

describe('destructive git forms', () => {
  it.each([
    ['git checkout .', 'high'],
    ['git checkout -f main', 'high'],
    ['git checkout --force main', 'high'],
    ['git restore src/a.ts', 'high'],
    ['git restore --worktree src/a.ts', 'high'],
    ['git stash clear', 'high'],
    ['git stash drop', 'medium'],
    ['git branch -D x', 'medium'],
  ] as const)('%s gives git-destructive %s', (text, level) => {
    expect(levelOf(text, 'git-destructive')).toBe(level);
  });

  it.each(['git checkout main', 'git checkout -b feature', 'git restore --staged src/a.ts', 'git stash list', 'git branch -d x', 'git stash'])(
    '%s gives nothing',
    (text) => {
      expect(ids(text)).toEqual([]);
    },
  );
});

describe('running downloaded code', () => {
  it('a shell reading a downloaded script through <( ) is high', () => {
    expect(runRules('bash <(curl -fsSL https://x)').some((h) => h.level === 'high')).toBe(true);
    expect(runRules('sh <(wget -qO- https://x)', 'bash').some((h) => h.level === 'high')).toBe(true);
  });

  it('a download saved with tee and run is still download-and-run', () => {
    expect(levelOf('curl -fsSL https://x | tee a.sh | sh', 'download-run')).toBe('high');
  });

  it('a shell reading a local file is quiet', () => {
    expect(ids('bash ./build.sh')).toEqual([]);
  });
});

describe('sh -c with a variable', () => {
  it.each(['bash -c "$CMD"', 'sh -c "$1"', 'sh -c "${SCRIPT}"'])('%s is hidden behaviour', (text) => {
    const h = runRules(text, 'bash').find((x) => x.area === 'hidden_behaviour');
    expect(h?.level).toBe('medium');
  });

  it('a plain script is quiet', () => {
    expect(ids('bash -c "echo hi"', 'bash')).toEqual([]);
  });
});

describe('PowerShell deletes fed by a pipeline', () => {
  it.each(['Get-ChildItem -Recurse *.tmp | Remove-Item', 'gci C:\\logs | rm'])('%s is high', (text) => {
    const h = runRules(text, 'powershell').find((x) => x.area === 'data_loss');
    expect(h?.level).toBe('high');
    expect(h?.reason).toMatch(/every item/);
  });
});

describe('cmd and PowerShell wildcards and joined switches', () => {
  it.each(['rd /s/q build', 'rmdir /S/Q build', 'del /f/s/q x', 'del "C:\\Users\\me\\*.*"'])('%s is high in cmd', (text) => {
    expect(levelOf(text, 'delete-recursive', 'cmd')).toBe('high');
  });

  it('a quoted PowerShell wildcard is high', () => {
    expect(levelOf('Remove-Item "C:\\temp\\*"', 'delete-recursive', 'powershell')).toBe('high');
  });

  it('a quoted unix wildcard is a literal name', () => {
    expect(levelOf('rm "*.log"', 'delete-file', 'bash')).toBe('medium');
  });
});

describe('one shell family per finding in auto mode', () => {
  it('a unix rm does not also get a PowerShell finding', () => {
    const hits = dataLoss('rm -rf build');
    expect(hits.some((h) => /Recycle Bin/.test(h.reason))).toBe(false);
    expect(hits.some((h) => h.id === 'delete-recursive' && h.level === 'high')).toBe(true);
  });

  it('a cmd del keeps the higher cmd finding over the PowerShell alias', () => {
    const hits = dataLoss('del /s /q build');
    expect(hits).toHaveLength(1);
    expect(hits[0].level).toBe('high');
  });

  it('distinct unix findings on one segment all stay', () => {
    expect(ids('rm -rf $HOME')).toEqual(expect.arrayContaining(['delete-recursive', 'delete-root-path']));
  });
});
