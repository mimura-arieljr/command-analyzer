import type { Segment } from '../../lex';
import { hit, NETWORK_MATCH } from '../define';
import { hasLong, hasShort, invocation, operands, pipedInto, snippetOf } from '../helpers';
import type { RuleContext, RuleFn } from '../types';

const DOWNLOADERS = new Set(['curl', 'wget', 'fetch', 'aria2c', 'http', 'https']);
export const RUNNERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'perl', 'ruby', 'node', 'php']);

export function runsInput(seg: Segment | undefined): boolean {
  const inv = seg && invocation(seg);
  return !!inv && RUNNERS.has(inv.name);
}

function isUpload(seg: Segment): boolean {
  const inv = invocation(seg);
  if (!inv) return false;
  const { name, args } = inv;
  if (name === 'curl') {
    const vals = args.map((w) => w.value);
    if (hasShort(args, 'T') || hasLong(args, ['--upload-file'])) return true;
    return vals.some((v, i) => {
      const next = vals[i + 1] ?? '';
      if (/^(-d|--data|--data-binary|--data-urlencode)$/.test(v)) return next.startsWith('@');
      if (/^-d@/.test(v)) return true;
      if (v === '-F' || v === '--form') return next.includes('=@') || next.includes('=<');
      return false;
    });
  }
  if (name === 'scp' || name === 'rsync') {
    const ops = operands(args);
    return ops.length >= 2 && /^[^/]*:/.test(ops[ops.length - 1].value);
  }
  return name === 'nc' || name === 'ncat' || name === 'netcat';
}

function downloadRun(seg: Segment, ctx: RuleContext) {
  const inv = invocation(seg);
  if (!inv || !DOWNLOADERS.has(inv.name)) return undefined;
  let next = pipedInto(seg, ctx);
  // A copy saved with tee still runs.
  while (next && invocation(next)?.name === 'tee') next = pipedInto(next, ctx);
  return runsInput(next) ? next : undefined;
}

export const downloadRunRule: RuleFn = (seg, ctx) => {
  const next = downloadRun(seg, ctx);
  if (!next) return [];
  return [
    hit(
      {
        id: 'download-run',
        area: 'network',
        level: 'high',
        certainty: 'certain',
        reason: 'Downloads code from the internet and runs it straight away, without you seeing it first. It can do anything your user (or root, with sudo) can do.',
        depends_on: 'Who controls the URL and what it serves at the moment you run it.',
        how_to_verify: 'Download the script to a file first, read it, then run it.',
        matchesModel: /download.*(run|execut)|(run|execut).*download|pipe.*(sh|bash|shell)/i,
      },
      snippetOf(ctx, seg, next),
    ),
  ];
};

export const downloadRule: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !DOWNLOADERS.has(inv.name) || downloadRun(seg, ctx) || isUpload(seg)) return [];
  return [
    hit(
      {
        id: 'download',
        area: 'network',
        level: 'low',
        certainty: 'certain',
        reason: 'Connects to the internet and downloads data.',
        depends_on: 'What the URL serves, and where the output is saved.',
        matchesModel: NETWORK_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const uploadRule: RuleFn = (seg, ctx) => {
  if (!isUpload(seg)) return [];
  return [
    hit(
      {
        id: 'upload',
        area: 'network',
        level: 'medium',
        certainty: 'certain',
        reason: 'Sends data from this machine to another machine over the network.',
        depends_on: 'Which files or data are sent and who receives them.',
        how_to_verify: 'Check the file names and the destination before running it.',
        matchesModel: /upload|send|transfer|exfil|connect/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const UNIX_NETWORK: RuleFn[] = [downloadRunRule, downloadRule, uploadRule];
