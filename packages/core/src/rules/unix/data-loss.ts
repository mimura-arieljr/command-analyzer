import type { Segment } from '../../lex';
import { DELETE_MATCH, hit, OVERWRITE_MATCH, RELATIVE_DEPENDS } from '../define';
import { DOTFILE_PATH, hasLong, hasShort, invocation, isVariable, isWild, operands, snippetOf, SYSTEM_PATH } from '../helpers';
import type { RuleFn, RuleHit } from '../types';

const TRASH = 'Files removed this way skip the Trash and cannot be recovered.';
const ROOT_TARGETS = new Set(['/', '/*', '~', '~/', '~/*', '..', '../', '$HOME', '${HOME}', '$HOME/', '"$HOME"']);

const isRelative = (v: string) => !/^[/~$]/.test(v);
const listOf = (vs: string[]) => vs.join(' ');

export const rmRules: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || (inv.name !== 'rm' && inv.name !== 'unlink')) return [];
  const snip = snippetOf(ctx, seg);
  const targets = operands(inv.args);
  const raws = targets.map((w) => w.raw);
  const out: RuleHit[] = [];
  const recursive = hasShort(inv.args, 'rR') || hasLong(inv.args, ['--recursive']);
  const force = hasShort(inv.args, 'f') || hasLong(inv.args, ['--force']);
  const wild = targets.some(isWild);
  const relative = targets.some((w) => isRelative(w.value));
  const root = targets.filter((w) => ROOT_TARGETS.has(w.raw) || ROOT_TARGETS.has(w.value));
  const vars = targets.filter((w) => isVariable(w) && !root.includes(w));
  const check = raws.length ? `Run "ls -d ${listOf(raws)}" first to see what it would delete.` : '';

  if (recursive || force || wild) {
    const what = recursive ? `${listOf(raws)} and everything inside` : listOf(raws);
    out.push(
      hit(
        {
          id: 'delete-recursive',
          area: 'data_loss',
          level: 'high',
          certainty: 'certain',
          reason: `Deletes ${what}${force ? ' without asking' : ''}. ${TRASH}`,
          depends_on: relative || wild ? RELATIVE_DEPENDS : '',
          how_to_verify: check,
          matchesModel: DELETE_MATCH,
        },
        snip,
      ),
    );
  }
  if (root.length) {
    out.push(
      hit(
        {
          id: 'delete-root-path',
          area: 'data_loss',
          level: 'high',
          certainty: 'certain',
          reason: `Targets ${listOf(root.map((w) => w.raw))}, which can wipe your home folder, the parent folder or the whole disk. ${TRASH}`,
          matchesModel: DELETE_MATCH,
        },
        snip,
      ),
    );
  }
  if (vars.length) {
    const names = listOf(vars.map((w) => w.raw));
    out.push(
      hit(
        {
          id: 'delete-variable-path',
          area: 'data_loss',
          level: 'high',
          certainty: 'possible',
          reason: `Deletes a path built from a variable (${names}). If the variable is empty, the path can turn into / or the current folder.`,
          depends_on: 'The value of the variable when the command runs.',
          how_to_verify: `Run echo ${names} first and check the path it prints.`,
          matchesModel: DELETE_MATCH,
        },
        snip,
      ),
    );
  }
  if (!out.length) {
    out.push(
      hit(
        {
          id: 'delete-file',
          area: 'data_loss',
          level: 'medium',
          certainty: 'certain',
          reason: `Deletes ${listOf(raws) || 'the named file'}. ${TRASH}`,
          depends_on: relative ? RELATIVE_DEPENDS : '',
          how_to_verify: check,
          matchesModel: DELETE_MATCH,
        },
        snip,
      ),
    );
  }
  return out;
};

const DELETERS = new Set(['rm', 'unlink', 'shred']);

export const findDelete: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'find') return [];
  const vals = inv.args.map((w) => w.value);
  const execAt = vals.findIndex((v) => v === '-exec' || v === '-execdir' || v === '-ok' || v === '-okdir');
  const execDeletes = execAt >= 0 && DELETERS.has((vals[execAt + 1] ?? '').split('/').pop() ?? '');
  if (!vals.includes('-delete') && !execDeletes) return [];
  return [
    hit(
      {
        id: 'find-delete',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: `Deletes every file that find matches. ${TRASH}`,
        depends_on: RELATIVE_DEPENDS,
        how_to_verify: 'Run the same find command without -delete or -exec first to see the list.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const XARGS_VALUE_FLAGS = new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a']);

function xargsCommand(seg: Segment): string | undefined {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'xargs') return undefined;
  for (let k = 0; k < inv.args.length; k++) {
    const v = inv.args[k].value;
    if (XARGS_VALUE_FLAGS.has(v)) {
      k++;
      continue;
    }
    if (v.startsWith('-')) continue;
    return v.split('/').pop();
  }
  return undefined;
}

export const xargsDelete: RuleFn = (seg, ctx) => {
  const cmd = xargsCommand(seg);
  if (!cmd || !DELETERS.has(cmd)) return [];
  return [
    hit(
      {
        id: 'xargs-delete',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: `Deletes every file in the list it receives. ${TRASH} File names with spaces can be split apart and hit the wrong files.`,
        depends_on: 'What the command before the pipe lists.',
        how_to_verify: 'Run the part before the pipe on its own first and read the list.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const wipe: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const { name, args } = inv;
  let reason = '';
  if (name === 'shred') reason = 'Overwrites the file contents so they cannot be recovered.';
  else if (name === 'truncate') reason = 'Cuts the file to a new size, throwing away its contents.';
  else if (name === 'dd' && args.some((w) => w.value.startsWith('of='))) reason = 'Writes raw data over the output file or disk given in of=.';
  else if (name.startsWith('mkfs') || name === 'wipefs') reason = 'Formats or wipes a disk or partition, erasing everything on it.';
  if (!reason) return [];
  return [
    hit(
      {
        id: 'wipe',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: `${reason} This cannot be undone.`,
        matchesModel: /wip|format|eras|overwrit|destroy/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const NULL_TARGETS = new Set(['/dev/null', '/dev/stderr', '/dev/stdout', '/dev/tty']);

export const overwriteRedirect: RuleFn = (seg, ctx) => {
  const out: RuleHit[] = [];
  for (const r of seg.redirects) {
    if (!/^(\d*|&)>\|?$/.test(r.op) || r.target === '' || r.target.startsWith('&') || NULL_TARGETS.has(r.target)) continue;
    const important = SYSTEM_PATH.test(r.target) || DOTFILE_PATH.test(r.target);
    out.push(
      hit(
        {
          id: 'overwrite-redirect',
          area: 'data_loss',
          level: important ? 'high' : 'low',
          certainty: 'possible',
          reason: `Overwrites ${r.target} if it already exists. Its old contents are lost.`,
          depends_on: `Whether ${r.target} already exists and holds anything you need.`,
          how_to_verify: `Run "ls -l ${r.target}" first. Use >> instead of > to add to the end of the file.`,
          matchesModel: OVERWRITE_MATCH,
        },
        snippetOf(ctx, seg),
      ),
    );
  }
  return out;
};

function gitSub(seg: Segment): { sub: string; args: Segment['words'] } | undefined {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'git') return undefined;
  let k = 0;
  while (k < inv.args.length && inv.args[k].value.startsWith('-')) {
    k += inv.args[k].value === '-C' || inv.args[k].value === '-c' ? 2 : 1;
  }
  const sub = inv.args[k]?.value;
  return sub ? { sub, args: inv.args.slice(k + 1) } : undefined;
}

export const gitRules: RuleFn = (seg, ctx) => {
  const g = gitSub(seg);
  if (!g) return [];
  const vals = g.args.map((w) => w.value);
  const snip = snippetOf(ctx, seg);
  let reason = '';
  if (g.sub === 'reset' && vals.includes('--hard')) reason = 'Throws away every uncommitted change in tracked files.';
  else if (g.sub === 'clean' && (hasShort(g.args, 'f') || hasLong(g.args, ['--force']))) reason = 'Deletes untracked files (and folders with -d, ignored files with -x). They are not in git, so they cannot be restored from it.';
  else if (g.sub === 'checkout' && vals.includes('--') && vals.some((v, i) => i > vals.indexOf('--'))) reason = 'Overwrites uncommitted changes in the named files with the committed version.';
  else if (g.sub === 'restore' && !vals.includes('--staged') && vals.some((v) => v === '.' || v === ':/')) reason = 'Overwrites uncommitted changes with the committed version.';
  if (reason) {
    return [
      hit(
        {
          id: 'git-destructive',
          area: 'data_loss',
          level: 'high',
          certainty: 'certain',
          reason: `${reason} Lost changes cannot be recovered.`,
          depends_on: 'Which repository you are in and what is uncommitted.',
          how_to_verify: 'Run "git status" first to see what would be lost.',
          matchesModel: /discard|throw|lose|lost|delet|overwrit/i,
        },
        snip,
      ),
    ];
  }
  if (g.sub === 'push' && (hasShort(g.args, 'f') || hasLong(g.args, ['--force', '--force-with-lease']))) {
    return [
      hit(
        {
          id: 'git-force-push',
          area: 'data_loss',
          level: 'medium',
          certainty: 'certain',
          reason: 'Force-pushes, replacing the remote branch history. Commits others pushed can be lost.',
          how_to_verify: 'Run "git log origin/<branch>..HEAD" and "git log HEAD..origin/<branch>" to compare first.',
          matchesModel: /force|overwrit|rewrit/i,
        },
        snip,
      ),
    ];
  }
  return [];
};

export const rsyncDelete: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'rsync' || !inv.args.some((w) => w.value.startsWith('--delete'))) return [];
  return [
    hit(
      {
        id: 'rsync-delete',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: 'Deletes files in the destination that are not in the source.',
        depends_on: 'Which side is the source. Swapping them deletes the wrong side.',
        how_to_verify: 'Run it with --dry-run first and read the list of deletions.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const crontabRemove: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'crontab' || !hasShort(inv.args, 'r')) return [];
  return [
    hit(
      {
        id: 'crontab-remove',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: 'Deletes all your scheduled cron jobs, without asking.',
        how_to_verify: 'Run "crontab -l" first and save the output.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const UNIX_DATA_LOSS: RuleFn[] = [rmRules, findDelete, xargsDelete, wipe, overwriteRedirect, gitRules, rsyncDelete, crontabRemove];

