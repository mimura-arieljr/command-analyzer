import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules';

const ids = (text: string) => runRules(text, 'cmd').map((h) => h.id);
const hit = (text: string, id: string) => runRules(text, 'cmd').find((h) => h.id === id);

describe('cmd rules', () => {
  it.each([
    ['del /s /q C:\\temp\\*', 'delete-recursive', 'data_loss'],
    ['erase *.log', 'delete-recursive', 'data_loss'],
    ['rd /s /q build', 'delete-recursive', 'data_loss'],
    ['rmdir /S build', 'delete-recursive', 'data_loss'],
    ['del notes.txt', 'delete-file', 'data_loss'],
    ['rd emptydir', 'delete-file', 'data_loss'],
    ['format D: /q', 'wipe', 'data_loss'],
    ['cipher /w:C:\\', 'wipe', 'data_loss'],
    ['dir > list.txt', 'overwrite-redirect', 'data_loss'],
    ['reg add HKLM\\Software\\X /v A /d 1', 'registry-change', 'system_changes'],
    ['reg delete HKCU\\Software\\X /f', 'registry-change', 'system_changes'],
    ['bcdedit /set testsigning on', 'boot-change', 'system_changes'],
    ['sc stop Spooler', 'service-change', 'system_changes'],
    ['schtasks /create /tn X /tr y.exe /sc daily', 'service-change', 'system_changes'],
    ['net stop Spooler', 'service-change', 'system_changes'],
    ['netsh advfirewall set allprofiles state off', 'firewall-change', 'system_changes'],
    ['icacls C:\\data /grant Everyone:F', 'permissions-change', 'system_changes'],
    ['takeown /f C:\\data /r', 'permissions-change', 'system_changes'],
    ['curl -o a.zip https://x', 'download', 'network'],
    ['certutil -urlcache -split -f https://x/a.exe a.exe', 'download', 'network'],
    ['bitsadmin /transfer j https://x C:\\a.exe', 'download', 'network'],
    ['runas /user:Administrator cmd', 'elevate', 'elevated_rights'],
    ['p^ow^er^shell -c whoami', 'caret-obfuscation', 'hidden_behaviour'],
  ])('%s gives %s in %s', (text, id, area) => {
    expect(hit(text, id)?.area).toBe(area);
  });

  it('levels follow the scale', () => {
    expect(hit('del /s /q C:\\temp\\*', 'delete-recursive')?.level).toBe('high');
    expect(hit('del notes.txt', 'delete-file')?.level).toBe('medium');
    expect(hit('reg delete HKCU\\Software\\X /f', 'registry-change')?.level).toBe('high');
    expect(hit('reg add HKLM\\Software\\X /v A /d 1', 'registry-change')?.level).toBe('medium');
    expect(hit('certutil -urlcache -split -f https://x/a.exe a.exe', 'download')?.level).toBe('medium');
    expect(hit('curl -o a.zip https://x', 'download')?.level).toBe('low');
    expect(hit('diskpart', 'wipe')?.certainty).toBe('possible');
  });

  it('read-only and echoed text give no hits', () => {
    expect(ids('dir /s')).toEqual([]);
    expect(ids('echo del /s x')).toEqual([]);
    expect(ids('dir >> list.txt')).toEqual([]);
    expect(ids('dir > nul')).toEqual([]);
    expect(ids('rem del /s /q C:\\')).toEqual([]);
  });

  it('cmd /c text is checked', () => {
    expect(ids('cmd /c "rd /s /q build"')).toContain('delete-recursive');
  });

  it('PowerShell inside cmd is checked with PowerShell rules', () => {
    expect(ids('powershell -Command "Remove-Item -Recurse -Force C:\\temp"')).toContain('delete-recursive');
    expect(ids('powershell -enc SQBFAFgA')).toContain('encoded-command');
  });

  it('runs every family when no shell is given', () => {
    expect(runRules('del /s /q C:\\temp').map((h) => h.id)).toContain('delete-recursive');
  });
});

describe('auto-detect (every family)', () => {
  it.each([
    'ls -la',
    'git status',
    'npm run build',
    'cat a.txt | grep foo',
    "awk '{print $1}' file.txt",
    'ps aux | grep node',
    'echo "a;del /s x"',
    "grep 'a|rm -rf b' f",
    'Get-ChildItem',
    'dir',
  ])('%s stays quiet', (text) => {
    expect(runRules(text)).toEqual([]);
  });
});
