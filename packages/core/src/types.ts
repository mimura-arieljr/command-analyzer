export type Level = 'none' | 'low' | 'medium' | 'high';
export type Certainty = 'certain' | 'possible';

export type Area = 'data_loss' | 'system_changes' | 'network' | 'elevated_rights' | 'hidden_behaviour';

// Page and report order.
export const AREAS: readonly Area[] = ['data_loss', 'system_changes', 'network', 'elevated_rights', 'hidden_behaviour'];

export const AREA_LABEL: Record<Area, string> = {
  data_loss: 'Data loss',
  system_changes: 'System changes',
  network: 'Network',
  elevated_rights: 'Elevated rights',
  hidden_behaviour: 'Hidden behaviour',
};

export type Shell = 'bash' | 'zsh' | 'sh' | 'powershell' | 'cmd';
export const SHELLS: readonly Shell[] = ['bash', 'zsh', 'sh', 'powershell', 'cmd'];

export type ShellFamily = 'unix' | 'powershell' | 'cmd';
export const FAMILIES: readonly ShellFamily[] = ['unix', 'powershell', 'cmd'];

export function familyOf(shell: Shell): ShellFamily {
  return shell === 'powershell' ? 'powershell' : shell === 'cmd' ? 'cmd' : 'unix';
}

export function isShell(value: unknown): value is Shell {
  return typeof value === 'string' && (SHELLS as readonly string[]).includes(value);
}

export interface Finding {
  reason: string;
  certainty: Certainty;
  depends_on: string;
  how_to_verify: string;
  // Exact text from the command, or "".
  snippet: string;
}

export interface FinalFinding extends Finding {
  source: 'ai' | 'rule';
  ruleId?: string;
}

export interface ShellInfo {
  name: Shell | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

export interface GlossaryFlag {
  token: string;
  meaning: string;
}

export interface GlossaryCommand {
  name: string;
  meaning: string;
  alias_note: string;
  flags: GlossaryFlag[];
}

export interface GlossarySymbol {
  token: string;
  meaning: string;
}

export interface Glossary {
  commands: GlossaryCommand[];
  symbols: GlossarySymbol[];
}

export interface Step {
  snippet: string;
  explanation: string;
  kind: 'step' | 'joiner';
}

export interface AreaResult<F extends Finding = Finding> {
  level: Level;
  findings: F[];
}

interface AnalysisShape<F extends Finding> {
  is_command: boolean;
  not_a_command_message: string;
  shell: ShellInfo;
  headline: string;
  what_it_does: string;
  glossary: Glossary;
  steps: Step[];
  risks: Record<Area, AreaResult<F>>;
}

export type ModelAnalysis = AnalysisShape<Finding>;

export interface FinalAnalysis extends AnalysisShape<FinalFinding> {
  overall: Level;
  // Set when the model call failed and only the rule checks ran.
  model_error?: ErrorCode;
}

export type ErrorCode = 'empty' | 'too_long' | 'bad_request' | 'unauthorized' | 'throttled' | 'bad_output' | 'failed';

export interface AnalyzeRequest {
  command: string;
  shell?: Shell;
}

export type AnalyzeResponse =
  | { ok: true; analysis: FinalAnalysis }
  | { ok: false; error: ErrorCode; message: string };

export const MAX_COMMAND_CHARS = 5000;
