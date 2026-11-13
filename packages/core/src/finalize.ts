import { rank } from './rules/helpers';
import { topHit, type RuleHit } from './rules';
import {
  AREAS,
  type Area,
  type AreaResult,
  type ErrorCode,
  type FinalAnalysis,
  type FinalFinding,
  type Finding,
  type Level,
  type ModelAnalysis,
  type Shell,
  type ShellInfo,
} from './types';

export const RULES_CLEAN_HEADLINE = 'No risky patterns found by the rule checks.';

export interface FinalizeOptions {
  // The shell the user forced in the picker.
  shell?: Shell;
}

const maxLevel = (a: Level, b: Level): Level => (rank(a) >= rank(b) ? a : b);

const tagAi = (f: Finding): FinalFinding => ({ ...f, source: 'ai' });

function fromHit(h: RuleHit): FinalFinding {
  return {
    reason: h.reason,
    certainty: h.certainty,
    depends_on: h.depends_on,
    how_to_verify: h.how_to_verify,
    snippet: h.snippet,
    source: 'rule',
    ruleId: h.id,
  };
}

// A model finding is a duplicate only when it is certain and matched by the hit's regex.
// - Each hit drops at most one model finding (the first match).
// - Possible model findings are always kept.
function dropDuplicates(findings: FinalFinding[], hits: RuleHit[]): FinalFinding[] {
  const kept = [...findings];
  for (const h of hits) {
    const i = kept.findIndex((f) => f.certainty === 'certain' && h.matchesModel.test(f.reason));
    if (i !== -1) kept.splice(i, 1);
  }
  return kept;
}

function mergeArea(model: AreaResult, hits: RuleHit[]): AreaResult<FinalFinding> {
  const kept = dropDuplicates(model.findings.map(tagAi), hits);
  const level = hits.reduce<Level>((acc, h) => maxLevel(acc, h.level), model.level);
  return { level, findings: [...kept, ...hits.map(fromHit)] };
}

const overallOf = (risks: Record<Area, AreaResult<FinalFinding> | AreaResult>): Level =>
  AREAS.reduce<Level>((acc, a) => maxLevel(acc, risks[a].level), 'none');

const forcedShell = (shell: Shell): ShellInfo => ({ name: shell, confidence: 'high', note: '' });

const hitsIn = (hits: RuleHit[], area: Area) => hits.filter((h) => h.area === area);

export function finalize(model: ModelAnalysis, hits: RuleHit[], opts: FinalizeOptions = {}): FinalAnalysis {
  const risks = Object.fromEntries(AREAS.map((a) => [a, mergeArea(model.risks[a], hitsIn(hits, a))])) as Record<
    Area,
    AreaResult<FinalFinding>
  >;
  const overall = overallOf(risks);
  const top = topHit(hits);
  const out: FinalAnalysis = { ...model, risks, overall };
  if (rank(overall) > rank(overallOf(model.risks)) && top) out.headline = top.reason;
  if (!model.is_command && top && rank(top.level) >= rank('medium')) {
    out.is_command = true;
    out.not_a_command_message = '';
    out.headline = top.reason;
  }
  if (opts.shell) out.shell = forcedShell(opts.shell);
  return out;
}

// The result when the model call failed: rule findings only.
export function rulesOnly(hits: RuleHit[], error: ErrorCode, opts: FinalizeOptions = {}): FinalAnalysis {
  const risks = Object.fromEntries(
    AREAS.map((a) => {
      const own = hitsIn(hits, a);
      return [a, { level: own.reduce<Level>((acc, h) => maxLevel(acc, h.level), 'none'), findings: own.map(fromHit) }];
    }),
  ) as Record<Area, AreaResult<FinalFinding>>;
  return {
    is_command: true,
    not_a_command_message: '',
    shell: opts.shell ? forcedShell(opts.shell) : { name: 'unknown', confidence: 'low', note: '' },
    headline: topHit(hits)?.reason ?? RULES_CLEAN_HEADLINE,
    what_it_does: '',
    glossary: { commands: [], symbols: [] },
    steps: [],
    risks,
    overall: overallOf(risks),
    model_error: error,
  };
}
