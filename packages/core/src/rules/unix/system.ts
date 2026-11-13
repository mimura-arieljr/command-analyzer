import { hit, SYSTEM_MATCH } from '../define';
import { hasLong, hasShort, invocation, operands, snippetOf, SYSTEM_PATH } from '../helpers';
import type { RuleFn } from '../types';

const OPEN_MODES = new Set(['777', '0777', 'a+rwx', 'o+w', 'a+w', '666', '0666']);

export const permissionsChange: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const { name, args } = inv;
  const recursive = hasShort(args, 'R') || hasLong(args, ['--recursive']);
  let reason = '';
  if (name === 'chmod' && args.some((w) => OPEN_MODES.has(w.value))) reason = 'Makes files writable (or readable and runnable) by every user on the machine.';
  else if (name === 'chmod' && recursive) reason = 'Changes permissions on a folder and everything inside it.';
  else if ((name === 'chown' || name === 'chgrp') && recursive) reason = 'Changes the owner of a folder and everything inside it.';
  if (!reason) return [];
  return [
    hit(
      {
        id: 'permissions-change',
        area: 'system_changes',
        level: 'medium',
        certainty: 'certain',
        reason: `${reason} Restoring the old permissions by hand is hard.`,
        how_to_verify: 'Run "ls -la" on the target first to note the current permissions.',
        matchesModel: /permission|owner|chmod|chown/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const WRITERS = new Set(['cp', 'mv', 'tee', 'ln', 'install']);

export const systemPathWrite: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !WRITERS.has(inv.name)) return [];
  const ops = operands(inv.args);
  const targets = inv.name === 'tee' ? ops : ops.slice(-1);
  const hits = targets.filter((w) => SYSTEM_PATH.test(w.value));
  if (!hits.length) return [];
  return [
    hit(
      {
        id: 'system-path-write',
        area: 'system_changes',
        level: 'medium',
        certainty: 'certain',
        reason: `Writes into a system folder (${hits.map((w) => w.raw).join(' ')}), which changes how the machine behaves.`,
        how_to_verify: 'Back up the existing file first and compare it after.',
        matchesModel: SYSTEM_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const SYSTEMCTL = new Set(['stop', 'disable', 'mask', 'kill', 'reboot', 'poweroff', 'halt']);
const LAUNCHCTL = new Set(['unload', 'bootout', 'remove', 'disable']);

export const serviceChange: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const vals = inv.args.map((w) => w.value);
  const yes =
    (inv.name === 'systemctl' && vals.some((v) => SYSTEMCTL.has(v))) ||
    (inv.name === 'launchctl' && vals.some((v) => LAUNCHCTL.has(v))) ||
    (inv.name === 'service' && vals.includes('stop'));
  if (!yes) return [];
  return [
    hit(
      {
        id: 'service-change',
        area: 'system_changes',
        level: 'medium',
        certainty: 'certain',
        reason: 'Stops, disables or removes a background service. Anything that depends on it stops working.',
        matchesModel: /service|daemon|stop|disabl/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const PKG_MANAGERS = new Set(['apt', 'apt-get', 'yum', 'dnf', 'zypper', 'brew', 'port', 'snap']);
const PKG_VERBS = new Set(['install', 'remove', 'uninstall', 'purge', 'upgrade', 'reinstall', 'autoremove']);
const JS_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

export const packageChange: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const { name, args } = inv;
  const vals = args.map((w) => w.value);
  const snip = snippetOf(ctx, seg);
  let pip = false;
  let yes = false;
  if (PKG_MANAGERS.has(name) && vals.some((v) => PKG_VERBS.has(v))) yes = true;
  if (name === 'pacman' && hasShort(args, 'SRU')) yes = true;
  if (JS_MANAGERS.has(name) && (hasShort(args, 'g') || hasLong(args, ['--global']) || vals[0] === 'global')) yes = true;
  if ((name === 'pip' || name === 'pip3') && vals.includes('install')) pip = true;
  if (/^python3?$/.test(name) && vals[0] === '-m' && vals[1]?.startsWith('pip') && vals.includes('install')) pip = true;
  if (!yes && !pip) return [];
  return [
    hit(
      {
        id: 'package-change',
        area: 'system_changes',
        level: 'low',
        certainty: pip ? 'possible' : 'certain',
        reason: pip
          ? 'Installs Python packages. Outside a virtual environment this changes the Python used by everything on the machine.'
          : 'Installs, removes or upgrades software for the whole machine or user.',
        depends_on: pip ? 'Whether a virtual environment is active.' : '',
        how_to_verify: pip ? 'Run "which python" and check it points inside a virtual environment.' : '',
        matchesModel: /install|package|upgrad|uninstall/i,
      },
      snip,
    ),
  ];
};

export const UNIX_SYSTEM: RuleFn[] = [permissionsChange, systemPathWrite, serviceChange, packageChange];
