import { commandWord } from '../../lex';
import { ELEVATE_MATCH, hit, HIDDEN_MATCH } from '../define';
import { hasLong, hasShort, invocation, pipedInto, snippetOf } from '../helpers';
import type { RuleFn } from '../types';
import { runsInput } from './network';

const PRIVILEGE = new Set(['sudo', 'su', 'doas', 'pkexec']);

export const elevate: RuleFn = (seg, ctx) => {
  const cw = commandWord(seg);
  if (!cw || !PRIVILEGE.has(cw.name)) return [];
  return [
    hit(
      {
        id: 'elevate',
        area: 'elevated_rights',
        level: 'medium',
        certainty: 'certain',
        reason: `Runs with administrator (root) rights through ${cw.name}, so mistakes can reach the whole system, not just your files.`,
        matchesModel: ELEVATE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const evalText: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  if (inv.name === 'eval') {
    return [
      hit(
        {
          id: 'eval-text',
          area: 'hidden_behaviour',
          level: 'medium',
          certainty: 'certain',
          reason: 'Runs text as a command. What actually runs depends on what that text contains when it runs.',
          depends_on: 'The contents of the text or variable being evaluated.',
          how_to_verify: 'Replace eval with echo and run that first to see the command it would run.',
          matchesModel: HIDDEN_MATCH,
        },
        snippetOf(ctx, seg),
      ),
    ];
  }
  if ((inv.name === 'source' || inv.name === '.') && inv.args.some((w) => w.raw.startsWith('<('))) {
    const remote = inv.args.some((w) => /^<\(\s*(curl|wget)\b/.test(w.raw));
    return [
      hit(
        {
          id: 'eval-text',
          area: 'hidden_behaviour',
          level: remote ? 'high' : 'medium',
          certainty: 'certain',
          reason: remote
            ? 'Downloads a script and runs it inside your current shell, without saving or showing it first.'
            : 'Runs the output of another command as shell code in your current shell.',
          how_to_verify: 'Run the command inside <( ) on its own first and read its output.',
          matchesModel: HIDDEN_MATCH,
        },
        snippetOf(ctx, seg),
      ),
    ];
  }
  return [];
};

export const decodeRun: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'base64' || !(hasShort(inv.args, 'dD') || hasLong(inv.args, ['--decode']))) return [];
  const next = pipedInto(seg, ctx);
  if (!runsInput(next)) return [];
  return [
    hit(
      {
        id: 'decode-run',
        area: 'hidden_behaviour',
        level: 'high',
        certainty: 'certain',
        reason: 'Decodes hidden (base64) text and runs it as code, so you cannot see what runs by reading the command.',
        how_to_verify: 'Run it without the final "| sh" part to read the decoded text first.',
        matchesModel: HIDDEN_MATCH,
      },
      snippetOf(ctx, seg, next!),
    ),
  ];
};

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

export const shellSubstitutionRun: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !SHELLS.has(inv.name)) return [];
  const k = inv.args.findIndex((w) => !w.quoted && /^-[a-z]*c[a-z]*$/i.test(w.value));
  const script = k >= 0 ? inv.args[k + 1] : undefined;
  if (!script || !(script.raw.includes('$(') || script.raw.includes('`'))) return [];
  return [
    hit(
      {
        id: 'shell-substitution-run',
        area: 'hidden_behaviour',
        level: 'high',
        certainty: 'certain',
        reason: 'Runs whatever another command prints as a new shell script. The real commands are not visible in what you pasted.',
        how_to_verify: 'Run the command inside $( ) on its own first and read what it prints.',
        matchesModel: HIDDEN_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const UNIX_ELEVATED: RuleFn[] = [elevate];
export const UNIX_HIDDEN: RuleFn[] = [evalText, decodeRun, shellSubstitutionRun];
