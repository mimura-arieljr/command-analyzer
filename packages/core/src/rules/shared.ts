import type { Word } from '../lex';
import { DELETE_MATCH, hit, RELATIVE_DEPENDS } from './define';
import { invocation, operands, snippetOf } from './helpers';
import type { RuleFn } from './types';

// Rules for programs that run the same way from bash, PowerShell and cmd.

const GONE = 'Deleted files skip the Trash or Recycle Bin and cannot be recovered.';
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const DLX = new Set(['pnpm', 'yarn']);

// The arguments given to package `pkg`, run directly or through a runner (npx -y rimraf dist, pnpm dlx rimraf dist).
function packageArgs(name: string, args: Word[], pkg: string): Word[] | undefined {
  if (name === pkg) return args;
  let rest = args;
  if (DLX.has(name)) {
    if (rest[0]?.value !== 'dlx') return undefined;
    rest = rest.slice(1);
  } else if (!RUNNERS.has(name)) return undefined;
  let k = 0;
  while (k < rest.length && rest[k].value.startsWith('-')) k += rest[k].value === '-p' || rest[k].value === '--package' ? 2 : 1;
  const found = rest[k]?.value.replace(/(?<=.)@.*$/, '');
  return found === pkg ? rest.slice(k + 1) : undefined;
}

export const rimrafRule: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  const args = inv && packageArgs(inv.name.replace(/\.cmd$/, ''), inv.args, 'rimraf');
  if (!args) return [];
  const targets = operands(args).map((w) => w.raw).join(' ') || 'the named paths';
  return [
    hit(
      {
        id: 'delete-recursive',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: `Deletes ${targets} and everything inside, like rm -rf, without asking. ${GONE}`,
        depends_on: RELATIVE_DEPENDS,
        how_to_verify: `List ${targets} first to see what it would delete.`,
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const mirrorDelete: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'robocopy' || !inv.args.some((w) => /^\/(mir|purge)$/i.test(w.value))) return [];
  return [
    hit(
      {
        id: 'mirror-delete',
        area: 'data_loss',
        level: 'high',
        certainty: 'certain',
        reason: `Deletes files in the destination that are not in the source (/MIR or /PURGE). ${GONE}`,
        depends_on: 'Which folder is the source. Swapping them deletes the wrong side.',
        how_to_verify: 'Run it with /L first to list what it would copy and delete.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const INTERPRETERS = new Set(['perl', 'python', 'python2', 'python3', 'py', 'ruby', 'node', 'php', 'bun', 'deno']);
const INLINE_FLAG = /^(-[A-Za-z]*[ceEr]|--eval|--print|--command|eval)$/;
// Calls that delete files or folders in common scripting languages.
const DELETE_CALL = /\b(os\.(remove|removedirs)|shutil\.rmtree|rmtree|remove_tree|unlink|rmdir|rmSync|fs(\.promises)?\.rm\b|FileUtils\.rm\w*|(File|Dir)\.delete)/;

export const scriptDelete: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !INTERPRETERS.has(inv.name) || !inv.args.some((w) => !w.quoted && INLINE_FLAG.test(w.value))) return [];
  const call = inv.args
    .map((w) => w.value)
    .join(' ')
    .match(DELETE_CALL)?.[0];
  if (!call) return [];
  return [
    hit(
      {
        id: 'script-delete',
        area: 'data_loss',
        level: 'high',
        certainty: 'possible',
        reason: `The inline ${inv.name} script calls ${call}, which deletes files or folders. ${GONE}`,
        depends_on: 'Which paths the script passes to it, and the folder you run it in.',
        how_to_verify: 'Read the script and print the paths it would delete before running it.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const SHARED_RULES: RuleFn[] = [rimrafRule, mirrorDelete, scriptDelete];
