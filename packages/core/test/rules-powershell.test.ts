import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules';

const ids = (text: string) => runRules(text, 'powershell').map((h) => h.id);
const hit = (text: string, id: string) => runRules(text, 'powershell').find((h) => h.id === id);

describe('PowerShell rules', () => {
  it.each([
    ['Remove-Item -Recurse -Force C:\\temp', 'delete-recursive', 'data_loss'],
    ['rm -r x', 'delete-recursive', 'data_loss'],
    ['ri -fo *.log', 'delete-recursive', 'data_loss'],
    ['remove-item -rec build', 'delete-recursive', 'data_loss'],
    ['Remove-Item notes.txt', 'delete-file', 'data_loss'],
    ['Clear-Content app.log', 'wipe', 'data_loss'],
    ['Format-Volume -DriveLetter D', 'wipe', 'data_loss'],
    ['Get-Process > procs.txt', 'overwrite-redirect', 'data_loss'],
    ['Set-Content -Path a.txt -Value x', 'overwrite-redirect', 'data_loss'],
    ['"x" | Out-File a.txt', 'overwrite-redirect', 'data_loss'],
    ['Set-ItemProperty -Path HKLM:\\Software\\X -Name A -Value 1', 'registry-change', 'system_changes'],
    ['Set-ExecutionPolicy Bypass -Scope Process', 'execution-policy', 'system_changes'],
    ['Stop-Service -Name Spooler', 'service-change', 'system_changes'],
    ['Register-ScheduledTask -TaskName X -Action $a', 'service-change', 'system_changes'],
    ['iex (iwr https://x)', 'download-run', 'network'],
    ['irm https://x | iex', 'download-run', 'network'],
    ["IEX (New-Object Net.WebClient).DownloadString('https://x')", 'download-run', 'network'],
    ['Invoke-WebRequest https://x -OutFile a.zip', 'download', 'network'],
    ['Invoke-RestMethod -Uri https://x -Method Post -Body $b', 'upload', 'network'],
    ['Start-Process pwsh -Verb RunAs', 'elevate', 'elevated_rights'],
    ['Invoke-Expression $cmd', 'eval-text', 'hidden_behaviour'],
    ['powershell -enc SQBFAFgA', 'encoded-command', 'hidden_behaviour'],
    ['pwsh -EncodedCommand SQBFAFgA', 'encoded-command', 'hidden_behaviour'],
    ['[Convert]::FromBase64String($s)', 'base64-decode', 'hidden_behaviour'],
  ])('%s gives %s in %s', (text, id, area) => {
    expect(hit(text, id)?.area).toBe(area);
  });

  it('levels follow the scale', () => {
    expect(hit('Remove-Item -Recurse -Force C:\\temp', 'delete-recursive')?.level).toBe('high');
    expect(hit('Remove-Item notes.txt', 'delete-file')?.level).toBe('medium');
    expect(hit('iex (iwr https://x)', 'download-run')?.level).toBe('high');
    expect(hit('powershell -enc SQBFAFgA', 'encoded-command')?.level).toBe('high');
    expect(hit('Get-Process > procs.txt', 'overwrite-redirect')).toMatchObject({ level: 'low', certainty: 'possible' });
    expect(hit('Remove-Item -Recurse -Force C:\\temp', 'delete-recursive')?.reason).toMatch(/Recycle Bin/);
  });

  it('Out-File -Append is not an overwrite', () => {
    expect(ids('"x" | Out-File a.txt -Append')).toEqual([]);
  });

  it('read-only and quoted text give no hits', () => {
    expect(ids('Get-ChildItem | Select-Object Name')).toEqual([]);
    expect(ids('Write-Host "Remove-Item -Recurse"')).toEqual([]);
    expect(ids('Get-Content log.txt | Select-String error')).toEqual([]);
    expect(ids('Get-Process > $null')).toEqual([]);
  });

  it('script blocks are checked', () => {
    expect(ids('Get-ChildItem *.tmp | ForEach-Object { Remove-Item $_ -Force }')).toContain('delete-recursive');
  });
});
