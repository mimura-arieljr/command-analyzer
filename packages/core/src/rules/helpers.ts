import { afterPrivilege, commandWord, innerCommands, type Segment, type Word } from '../lex';
import type { Level } from '../types';
import type { RuleContext } from './types';

export interface Invocation {
  name: string;
  args: Word[];
}

// The command a segment runs and its arguments; sudo/doas are looked through.
export function invocation(seg: Segment): Invocation | null {
  const s = afterPrivilege(seg);
  const cw = commandWord(s);
  if (!cw) return null;
  return { name: cw.name, args: s.words.slice(cw.index + 1) };
}

// Unix-style short flags, combined or not (`-rf` has r and f). Stops at `--`.
export function hasShort(args: Word[], chars: string): boolean {
  for (const w of args) {
    if (w.value === '--') return false;
    if (!w.quoted && /^-[A-Za-z]+$/.test(w.value) && [...chars].some((c) => w.value.slice(1).includes(c))) return true;
  }
  return false;
}

// Exact long flags, also as `--flag=value`. Stops at `--`.
export function hasLong(args: Word[], names: string[]): boolean {
  for (const w of args) {
    if (w.value === '--') return false;
    if (names.some((n) => w.value === n || w.value.startsWith(n + '='))) return true;
  }
  return false;
}

// Arguments that are not flags (everything after `--` counts).
export function operands(args: Word[], flagPrefix = '-'): Word[] {
  const out: Word[] = [];
  let ended = false;
  for (const w of args) {
    if (!ended && w.value === '--') {
      ended = true;
      continue;
    }
    if (!ended && w.value.startsWith(flagPrefix) && w.value.length > 1) continue;
    out.push(w);
  }
  return out;
}

export const isWild = (w: Word) => /[*?]/.test(w.quoted ? '' : w.value);
// cmd and PowerShell expand wildcards inside quotes too.
export const isWildAnyQuote = (w: Word) => /[*?]/.test(w.value);

// Redirect targets that throw output away instead of writing a file, in any shell.
const NULL_TARGETS = new Set(['/dev/null', '/dev/stderr', '/dev/stdout', '/dev/tty', 'nul', 'nul:', '$null']);
export const isNullTarget = (t: string) => NULL_TARGETS.has(t.toLowerCase().replace(/[;,]+$/, ''));

// The commands a segment hands to another program (find -exec, xargs), as invocations.
export function innerInvocations(seg: Segment): Invocation[] {
  return innerCommands(seg).flatMap((s) => {
    const inv = invocation(s);
    return inv ? [inv] : [];
  });
}
export const isVariable = (w: Word) => /\$[{(]?[A-Za-z_0-9@*]/.test(w.raw) || /%[A-Za-z_]+%/.test(w.raw);

export function snippetOf(ctx: RuleContext, seg: Segment, to: Segment = seg): string {
  return ctx.text.slice(seg.start, to.end);
}

// The segment this one pipes into, if any.
export function pipedInto(seg: Segment, ctx: RuleContext): Segment | undefined {
  if (seg.joinerAfter !== '|') return undefined;
  const next = ctx.segments[ctx.segments.indexOf(seg) + 1];
  return next && next.joinerBefore === '|' && next.nested === seg.nested ? next : undefined;
}

export const LEVEL_ORDER: readonly Level[] = ['none', 'low', 'medium', 'high'];
export const rank = (l: Level) => LEVEL_ORDER.indexOf(l);

export const SYSTEM_PATH = /^(\/etc|\/usr|\/System|\/Library|\/boot|\/bin|\/sbin|\/var\/db)(\/|$)/;
export const DOTFILE_PATH = /^(~|\$HOME|\$\{HOME\})\/\.[^/]/;
