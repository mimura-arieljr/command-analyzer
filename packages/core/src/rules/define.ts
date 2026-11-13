import type { Area, Certainty, Level } from '../types';
import type { RuleHit } from './types';

export interface HitSpec {
  id: string;
  area: Area;
  level: Level;
  certainty: Certainty;
  reason: string;
  depends_on?: string;
  how_to_verify?: string;
  matchesModel: RegExp;
}

export function hit(spec: HitSpec, snippet: string): RuleHit {
  return { depends_on: '', how_to_verify: '', ...spec, snippet };
}

// Shared wording and de-duplication patterns.
export const DELETE_MATCH = /\b(delet|remov|eras|wip)/i;
export const OVERWRITE_MATCH = /overwrit|replac|truncat/i;
export const NETWORK_MATCH = /download|upload|internet|network|url|remote|send/i;
export const ELEVATE_MATCH = /sudo|root|admin|elevat|privileg/i;
export const HIDDEN_MATCH = /eval|encod|base64|hidden|obfusc|runs? (the )?(text|string)/i;
export const SYSTEM_MATCH = /permission|service|registry|system|install|config|owner/i;

export const RELATIVE_DEPENDS = 'The folder you run it in: relative paths and wildcards are resolved from there.';
