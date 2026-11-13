import { lex } from '../lex';
import { FAMILIES, familyOf, type Shell, type ShellFamily } from '../types';
import { rank } from './helpers';
import type { RuleFn, RuleHit } from './types';
import { CMD_RULES } from './cmd';
import { encodedCommand, POWERSHELL_RULES } from './powershell';
import { UNIX_RULES } from './unix';

export type { RuleHit } from './types';

const RULESETS: Record<ShellFamily, RuleFn[]> = {
  unix: [...UNIX_RULES, encodedCommand],
  powershell: POWERSHELL_RULES,
  cmd: CMD_RULES,
};

// Same id and snippet means the same finding; keep the higher level.
function dedupe(hits: RuleHit[]): RuleHit[] {
  const byKey = new Map<string, RuleHit>();
  for (const h of hits) {
    const key = `${h.id}\u0000${h.snippet}`;
    const seen = byKey.get(key);
    if (!seen || rank(h.level) > rank(seen.level)) byKey.set(key, h);
  }
  const kept = [...byKey.values()];
  // A plain download inside a download-and-run is the same finding.
  const runs = kept.filter((h) => h.id === 'download-run');
  return kept.filter((h) => h.id !== 'download' || !runs.some((r) => r.snippet.includes(h.snippet)));
}

// Runs the rules for the given shell's family, or for every family when the shell is unknown.
// - Each segment is checked with the rules of its own family (cmd can contain PowerShell).
export function runRules(text: string, shell?: Shell): RuleHit[] {
  const families = shell ? [familyOf(shell)] : FAMILIES;
  const all: RuleHit[] = [];
  for (const family of families) {
    const segments = lex(text, family);
    segments.forEach((seg, index) => {
      for (const rule of RULESETS[seg.family]) all.push(...rule(seg, { text, segments, index }));
    });
  }
  return dedupe(all);
}

// Highest level first, then the first found.
export function topHit(hits: RuleHit[]): RuleHit | undefined {
  return hits.reduce<RuleHit | undefined>((best, h) => (!best || rank(h.level) > rank(best.level) ? h : best), undefined);
}
