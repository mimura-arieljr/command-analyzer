import type { Segment } from '../lex';
import type { Area, Certainty, Level } from '../types';

export interface RuleHit {
  id: string;
  area: Area;
  level: Level;
  certainty: Certainty;
  reason: string;
  depends_on: string;
  how_to_verify: string;
  // Exact text from the command.
  snippet: string;
  // Matches a model finding that reports the same thing (for de-duplication).
  matchesModel: RegExp;
}

export interface RuleContext {
  text: string;
  // Every segment of this reading, in order; `index` is the current one.
  segments: Segment[];
  index: number;
}

// Rules are independent: each reads one segment (and its neighbours), never another rule's hits.
export type RuleFn = (seg: Segment, ctx: RuleContext) => RuleHit[];
