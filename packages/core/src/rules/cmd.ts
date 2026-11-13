import type { Word } from '../lex';
import { DELETE_MATCH, ELEVATE_MATCH, hit, HIDDEN_MATCH, NETWORK_MATCH, OVERWRITE_MATCH, RELATIVE_DEPENDS, SYSTEM_MATCH } from './define';
import { invocation, isWild, operands, snippetOf } from './helpers';
import { encodedCommand } from './powershell';
import type { RuleFn, RuleHit } from './types';

const RECYCLE = 'Files removed this way skip the Recycle Bin and cannot be recovered.';

const switches = (args: Word[]) => args.filter((w) => w.value.startsWith('/')).map((w) => w.value.toLowerCase());
const hasSwitch = (args: Word[], ...names: string[]) => switches(args).some((s) => names.some((n) => s === n || s.startsWith(n + ':')));

export const cmdDelete: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const isDel = inv.name === 'del' || inv.name === 'erase';
  const isRd = inv.name === 'rd' || inv.name === 'rmdir';
  if (!isDel && !isRd) return [];
  const targets = operands(inv.args, '/');
  const broad = isRd ? hasSwitch(inv.args, '/s') : hasSwitch(inv.args, '/s', '/q', '/f') || targets.some(isWild);
  const what = targets.map((w) => w.raw).join(' ') || 'the named files';
  return [
    hit(
      {
        id: broad ? 'delete-recursive' : 'delete-file',
        area: 'data_loss',
        level: broad ? 'high' : 'medium',
        certainty: 'certain',
        reason: `Deletes ${what}${isRd && broad ? ' and everything inside' : ''}${hasSwitch(inv.args, '/q') ? ' without asking' : ''}. ${RECYCLE}`,
        depends_on: RELATIVE_DEPENDS,
        how_to_verify: `Run "dir ${what}" first to see what it would delete.`,
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const cmdWipe: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  let reason = '';
  let possible = false;
  if (inv.name === 'format') reason = 'Formats a drive, erasing everything on it.';
  else if (inv.name === 'cipher' && hasSwitch(inv.args, '/w')) reason = 'Overwrites the free space on a drive so deleted files can never be recovered.';
  else if (inv.name === 'diskpart') {
    reason = 'Opens the disk partitioning tool, which can delete partitions and wipe disks.';
    possible = true;
  }
  if (!reason) return [];
  return [
    hit(
      {
        id: 'wipe',
        area: 'data_loss',
        level: 'high',
        certainty: possible ? 'possible' : 'certain',
        reason: `${reason} This cannot be undone.`,
        depends_on: possible ? 'The commands given to diskpart (for example in a script with /s).' : '',
        matchesModel: /wip|format|eras|partition/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const cmdOverwrite: RuleFn = (seg, ctx) => {
  const out: RuleHit[] = [];
  for (const r of seg.redirects) {
    if (!/^\d*>$/.test(r.op) || r.target === '' || r.target.startsWith('&') || r.target.toLowerCase() === 'nul') continue;
    out.push(
      hit(
        {
          id: 'overwrite-redirect',
          area: 'data_loss',
          level: 'low',
          certainty: 'possible',
          reason: `Overwrites ${r.target} if it already exists. Its old contents are lost.`,
          depends_on: `Whether ${r.target} already exists and holds anything you need.`,
          how_to_verify: `Run "dir ${r.target}" first. Use >> instead of > to add to the end of the file.`,
          matchesModel: OVERWRITE_MATCH,
        },
        snippetOf(ctx, seg),
      ),
    );
  }
  return out;
};

function systemHit(id: string, level: 'medium' | 'high', reason: string, possible = false): Omit<Parameters<typeof hit>[0], 'matchesModel'> {
  return { id, area: 'system_changes', level, certainty: possible ? 'possible' : 'certain', reason };
}

export const cmdSystem: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const { name, args } = inv;
  const sub = args[0]?.value.toLowerCase() ?? '';
  const sw = switches(args);
  let spec: ReturnType<typeof systemHit> | undefined;
  if (name === 'reg' && sub === 'delete') spec = systemHit('registry-change', 'high', 'Deletes Windows registry keys or values, which can break installed software or Windows itself.');
  else if (name === 'reg' && (sub === 'add' || sub === 'import')) spec = systemHit('registry-change', 'medium', 'Changes the Windows registry, which controls how Windows and installed software behave.');
  else if (name === 'bcdedit' && args.length > 0 && !sw.includes('/enum') && !sw.includes('/v')) spec = systemHit('boot-change', 'high', 'Changes how Windows starts. A wrong setting can stop the machine from booting.');
  else if (name === 'sc' && ['config', 'delete', 'stop', 'create'].includes(sub)) spec = systemHit('service-change', 'medium', 'Changes, stops or removes a Windows service.');
  else if (name === 'schtasks' && sw.some((s) => ['/create', '/delete', '/change'].includes(s))) spec = systemHit('service-change', 'medium', 'Creates, changes or deletes a scheduled task.');
  else if (name === 'net' && sub === 'stop') spec = systemHit('service-change', 'medium', 'Stops a Windows service.');
  else if (name === 'netsh' && !args.some((w) => /^show$/i.test(w.value))) spec = systemHit('firewall-change', 'medium', 'Changes network or firewall settings.', true);
  else if (name === 'icacls' && sw.some((s) => ['/grant', '/reset', '/setowner', '/remove', '/deny'].some((n) => s.startsWith(n)))) spec = systemHit('permissions-change', 'medium', 'Changes who can read or change files and folders.');
  else if (name === 'takeown') spec = systemHit('permissions-change', 'medium', 'Takes ownership of files or folders away from their current owner.');
  if (!spec) return [];
  return [hit({ ...spec, depends_on: spec.certainty === 'possible' ? 'Which netsh command runs: show commands only read.' : '', matchesModel: SYSTEM_MATCH }, snippetOf(ctx, seg))];
};

export const cmdDownload: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const certutil = inv.name === 'certutil' && inv.args.some((w) => /^[-/]urlcache$/i.test(w.value));
  const bits = inv.name === 'bitsadmin' && hasSwitch(inv.args, '/transfer');
  if (!certutil && !bits && inv.name !== 'curl') return [];
  return [
    hit(
      {
        id: 'download',
        area: 'network',
        level: certutil ? 'medium' : 'low',
        certainty: 'certain',
        reason: certutil
          ? 'Downloads a file with certutil, a trick often used to fetch programs past security tools.'
          : 'Connects to the internet and downloads data.',
        depends_on: 'What the URL serves, and where the output is saved.',
        matchesModel: NETWORK_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const cmdElevate: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'runas') return [];
  return [
    hit(
      { id: 'elevate', area: 'elevated_rights', level: 'medium', certainty: 'certain', reason: 'Runs a program as another user, often an administrator.', matchesModel: ELEVATE_MATCH },
      snippetOf(ctx, seg),
    ),
  ];
};

export const caretObfuscation: RuleFn = (seg, ctx) => {
  if (!seg.words[0] || !/[A-Za-z]\^[A-Za-z]/.test(seg.words[0].raw)) return [];
  return [
    hit(
      {
        id: 'caret-obfuscation',
        area: 'hidden_behaviour',
        level: 'medium',
        certainty: 'possible',
        reason: `The command name is broken up with ^ characters (it runs as ${seg.words[0].value}). This is a common way to hide a command from security tools.`,
        depends_on: 'Why the command was written this way.',
        matchesModel: HIDDEN_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const CMD_RULES: RuleFn[] = [cmdDelete, cmdWipe, cmdOverwrite, cmdSystem, cmdDownload, cmdElevate, caretObfuscation, encodedCommand];
