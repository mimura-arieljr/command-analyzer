import type { Segment, Word } from '../lex';
import { DELETE_MATCH, ELEVATE_MATCH, hit, HIDDEN_MATCH, NETWORK_MATCH, OVERWRITE_MATCH, RELATIVE_DEPENDS, SYSTEM_MATCH } from './define';
import { invocation, isNullTarget, isWildAnyQuote, operands, pipedInto, snippetOf } from './helpers';
import type { RuleContext, RuleFn, RuleHit } from './types';

const RECYCLE = 'Items removed this way skip the Recycle Bin and cannot be recovered.';

// A PowerShell parameter by full name, unambiguous prefix (2+ letters) or alias. Case-insensitive.
export function psParam(args: Word[], full: string, aliases: string[] = []): Word | undefined {
  return args.find((w) => {
    if (w.quoted || !w.value.startsWith('-') || w.value.length < 2) return false;
    const p = w.value.slice(1).split(':')[0].toLowerCase();
    return aliases.includes(p) || (p.length >= 2 && full.startsWith(p));
  });
}

// The value after a parameter (`-Verb RunAs` or `-Verb:RunAs`).
function psValue(args: Word[], full: string, aliases: string[] = []): string | undefined {
  const w = psParam(args, full, aliases);
  if (!w) return undefined;
  const colon = w.value.indexOf(':');
  if (colon >= 0) return w.value.slice(colon + 1);
  return args[args.indexOf(w) + 1]?.value;
}

const REMOVE = new Set(['remove-item', 'rm', 'del', 'rd', 'ri', 'rmdir', 'erase']);
const REGISTRY = /^(HKLM|HKCU|HKCR|HKU|HKCC):|^Registry::/i;
const isRegistry = (args: Word[]) => args.some((w) => REGISTRY.test(w.value));

export const psDelete: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !REMOVE.has(inv.name) || isRegistry(inv.args)) return [];
  const targets = operands(inv.args).map((w) => w.raw);
  const recursive = !!psParam(inv.args, 'recurse', ['r']);
  const force = !!psParam(inv.args, 'force');
  const wild = operands(inv.args).some(isWildAnyQuote);
  // Fed by a pipeline, it deletes whatever the previous command lists (like xargs rm).
  const piped = seg.joinerBefore === '|' && targets.length === 0;
  const what = targets.join(' ') || (piped ? 'every item the previous command lists' : 'the named items');
  const check = targets.length
    ? `Run "Get-ChildItem ${targets.join(', ')}" first to see what it would delete.`
    : piped
      ? 'Run the part before the pipe on its own first and read the list.'
      : '';
  const broad = recursive || force || wild || piped;
  return [
    hit(
      {
        id: broad ? 'delete-recursive' : 'delete-file',
        area: 'data_loss',
        level: broad ? 'high' : 'medium',
        certainty: 'certain',
        reason: `Deletes ${what}${recursive ? ' and everything inside' : ''}${force ? ', including hidden and read-only items' : ''}. ${RECYCLE}`,
        depends_on: RELATIVE_DEPENDS,
        how_to_verify: check ? `${check} Adding -WhatIf also shows it without deleting.` : 'Add -WhatIf to see what it would delete.',
        matchesModel: DELETE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const WIPE: Record<string, string> = {
  'clear-content': 'Empties the contents of the file.',
  clc: 'Empties the contents of the file.',
  'format-volume': 'Formats a drive, erasing everything on it.',
  'clear-disk': 'Erases a whole disk.',
  'remove-partition': 'Deletes a disk partition and the data on it.',
  'initialize-disk': 'Initializes a disk, which can erase its partition table.',
};

export const psWipe: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  const reason = inv && WIPE[inv.name];
  if (!reason) return [];
  return [
    hit(
      { id: 'wipe', area: 'data_loss', level: 'high', certainty: 'certain', reason: `${reason} This cannot be undone.`, matchesModel: /wip|format|eras|empt|clear/i },
      snippetOf(ctx, seg),
    ),
  ];
};

const IMPORTANT_PS = /^(C:\\Windows|\$env:windir|\$PROFILE|\$env:SystemRoot)/i;

function overwriteHit(ctx: RuleContext, seg: Segment, target: string): RuleHit {
  return hit(
    {
      id: 'overwrite-redirect',
      area: 'data_loss',
      level: IMPORTANT_PS.test(target) ? 'high' : 'low',
      certainty: 'possible',
      reason: `Overwrites ${target || 'the file'} if it already exists. Its old contents are lost.`,
      depends_on: `Whether ${target || 'the file'} already exists and holds anything you need.`,
      how_to_verify: target ? `Run "Test-Path ${target}" first.` : '',
      matchesModel: OVERWRITE_MATCH,
    },
    snippetOf(ctx, seg),
  );
}

export const psOverwrite: RuleFn = (seg, ctx) => {
  const out: RuleHit[] = [];
  for (const r of seg.redirects) {
    if (!/^(\d*|\*)>$/.test(r.op) || r.target === '' || r.target.startsWith('&') || isNullTarget(r.target)) continue;
    out.push(overwriteHit(ctx, seg, r.target));
  }
  const inv = invocation(seg);
  if (inv && ['set-content', 'sc', 'out-file'].includes(inv.name) && !psParam(inv.args, 'append')) {
    const target = psValue(inv.args, inv.name === 'out-file' ? 'filepath' : 'path', ['path']) ?? operands(inv.args)[0]?.value ?? '';
    out.push(overwriteHit(ctx, seg, target));
  }
  return out;
};

const REG_WRITERS = new Set(['set-itemproperty', 'sp', 'new-itemproperty', 'remove-itemproperty', 'rp', 'new-item', 'ni', 'set-item', 'si', ...REMOVE]);

export const psRegistry: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !REG_WRITERS.has(inv.name) || !isRegistry(inv.args)) return [];
  const removesKey = REMOVE.has(inv.name) && inv.args.some((w) => /^HKLM:|^Registry::HKEY_LOCAL_MACHINE/i.test(w.value));
  return [
    hit(
      {
        id: 'registry-change',
        area: 'system_changes',
        level: removesKey ? 'high' : 'medium',
        certainty: 'certain',
        reason: removesKey
          ? 'Deletes a key from the machine-wide Windows registry, which can break installed software or Windows itself.'
          : 'Changes the Windows registry, which controls how Windows and installed software behave.',
        how_to_verify: 'Export the key first (reg export) so you can restore it.',
        matchesModel: /registry/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const psExecutionPolicy: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || inv.name !== 'set-executionpolicy') return [];
  return [
    hit(
      {
        id: 'execution-policy',
        area: 'system_changes',
        level: 'medium',
        certainty: 'certain',
        reason: 'Changes which PowerShell scripts are allowed to run. Bypass or Unrestricted lets any script run.',
        matchesModel: /execution policy|policy/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const SERVICES = new Set([
  'stop-service', 'spsv', 'set-service', 'new-service', 'remove-service', 'restart-service',
  'register-scheduledtask', 'unregister-scheduledtask', 'stop-computer', 'restart-computer',
]);

export const psService: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !SERVICES.has(inv.name)) return [];
  return [
    hit(
      {
        id: 'service-change',
        area: 'system_changes',
        level: 'medium',
        certainty: 'certain',
        reason: 'Changes a Windows service, a scheduled task or the machine power state. Anything that depends on it is affected.',
        matchesModel: SYSTEM_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

const PS_DOWNLOADERS = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'curl', 'wget', 'start-bitstransfer']);
const REMOTE_TEXT = /\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b|downloadstring|downloadfile|net\.webclient/i;
const EVAL = new Set(['iex', 'invoke-expression']);

function isPsDownload(seg: Segment): boolean {
  const inv = invocation(seg);
  return !!inv && (PS_DOWNLOADERS.has(inv.name) || /downloadstring|downloadfile/i.test(seg.raw));
}

function downloadRunTarget(seg: Segment, ctx: RuleContext): Segment | undefined | 'self' {
  const inv = invocation(seg);
  if (inv && EVAL.has(inv.name) && REMOTE_TEXT.test(seg.raw)) return 'self';
  if (!isPsDownload(seg)) return undefined;
  const next = pipedInto(seg, ctx);
  const nextInv = next && invocation(next);
  return nextInv && EVAL.has(nextInv.name) ? next : undefined;
}

export const psDownloadRun: RuleFn = (seg, ctx) => {
  const target = downloadRunTarget(seg, ctx);
  if (!target) return [];
  return [
    hit(
      {
        id: 'download-run',
        area: 'network',
        level: 'high',
        certainty: 'certain',
        reason: 'Downloads code from the internet and runs it straight away, without you seeing it first.',
        depends_on: 'Who controls the URL and what it serves at the moment you run it.',
        how_to_verify: 'Save the script to a file first, read it, then run it.',
        matchesModel: /download.*(run|execut)|(run|execut).*download/i,
      },
      snippetOf(ctx, seg, target === 'self' ? seg : target),
    ),
  ];
};

function isPsUpload(seg: Segment): boolean {
  const inv = invocation(seg);
  if (!inv || !['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'].includes(inv.name)) return false;
  if (psParam(inv.args, 'infile')) return true;
  const method = psValue(inv.args, 'method')?.toLowerCase();
  return (method === 'post' || method === 'put') && !!psParam(inv.args, 'body');
}

export const psDownload: RuleFn = (seg, ctx) => {
  if (!isPsDownload(seg) || downloadRunTarget(seg, ctx) || isPsUpload(seg)) return [];
  return [
    hit(
      { id: 'download', area: 'network', level: 'low', certainty: 'certain', reason: 'Connects to the internet and downloads data.', depends_on: 'What the URL serves, and where the output is saved.', matchesModel: NETWORK_MATCH },
      snippetOf(ctx, seg),
    ),
  ];
};

export const psUpload: RuleFn = (seg, ctx) => {
  if (!isPsUpload(seg)) return [];
  return [
    hit(
      {
        id: 'upload',
        area: 'network',
        level: 'medium',
        certainty: 'certain',
        reason: 'Sends data from this machine to a web address.',
        depends_on: 'What the body or file contains and who receives it.',
        matchesModel: /upload|send|post|transfer/i,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const psElevate: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !['start-process', 'saps', 'start'].includes(inv.name)) return [];
  if (psValue(inv.args, 'verb')?.toLowerCase() !== 'runas') return [];
  return [
    hit(
      {
        id: 'elevate',
        area: 'elevated_rights',
        level: 'medium',
        certainty: 'certain',
        reason: 'Starts a program as administrator, so it can change the whole system.',
        matchesModel: ELEVATE_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const psEval: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv || !EVAL.has(inv.name) || downloadRunTarget(seg, ctx)) return [];
  return [
    hit(
      {
        id: 'eval-text',
        area: 'hidden_behaviour',
        level: 'medium',
        certainty: 'certain',
        reason: 'Runs text as a PowerShell command. What actually runs depends on what that text contains.',
        depends_on: 'The contents of the text or variable being run.',
        how_to_verify: 'Print the text first (Write-Output) instead of running it.',
        matchesModel: HIDDEN_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

// Shared by every family: powershell can be launched from bash or cmd too.
export const encodedCommand: RuleFn = (seg, ctx) => {
  const inv = invocation(seg);
  if (!inv) return [];
  const name = inv.name.toLowerCase().replace(/\.exe$/, '');
  if (name !== 'powershell' && name !== 'pwsh') return [];
  if (!psParam(inv.args, 'encodedcommand', ['e', 'ec', 'enc'])) return [];
  return [
    hit(
      {
        id: 'encoded-command',
        area: 'hidden_behaviour',
        level: 'high',
        certainty: 'certain',
        reason: 'Runs a PowerShell command hidden in base64, so you cannot see what it does by reading it.',
        how_to_verify: 'Decode it first: [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String("<text>")).',
        matchesModel: HIDDEN_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const psBase64: RuleFn = (seg, ctx) => {
  if (!/FromBase64String/i.test(seg.raw)) return [];
  return [
    hit(
      {
        id: 'base64-decode',
        area: 'hidden_behaviour',
        level: 'medium',
        certainty: 'certain',
        reason: 'Decodes base64 text. Hidden content like this is often used to disguise what a command does.',
        how_to_verify: 'Decode the text on its own and read it before running anything with it.',
        matchesModel: HIDDEN_MATCH,
      },
      snippetOf(ctx, seg),
    ),
  ];
};

export const POWERSHELL_RULES: RuleFn[] = [
  psDelete, psWipe, psOverwrite, psRegistry, psExecutionPolicy, psService,
  psDownloadRun, psDownload, psUpload, psElevate, psEval, encodedCommand, psBase64,
];
