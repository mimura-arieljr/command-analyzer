import type { FinalAnalysis, FinalFinding } from '@ca/core/types';

export const FIND_XARGS = 'find . -name "*.log" -mtime +7 | xargs rm -f';

const none = () => ({ level: 'none' as const, findings: [] as FinalFinding[] });

export function finding(over: Partial<FinalFinding> = {}): FinalFinding {
  return {
    reason: 'rm -f deletes without asking. The files skip the Trash and cannot be recovered.',
    certainty: 'certain',
    depends_on: 'The folder you run it in.',
    how_to_verify: '',
    snippet: 'xargs rm -f',
    source: 'rule',
    ruleId: 'xargs-delete',
    ...over,
  };
}

// The mockup example, as the API returns it.
export function findXargs(over: Partial<FinalAnalysis> = {}): FinalAnalysis {
  return {
    is_command: true,
    not_a_command_message: '',
    shell: { name: 'bash', confidence: 'high', note: '' },
    headline: 'Permanently deletes every .log file older than 7 days in this folder and its subfolders.',
    what_it_does: 'Finds log files older than a week in this folder tree and deletes them.',
    glossary: {
      commands: [
        {
          name: 'find',
          meaning: 'searches a folder tree for files that match conditions',
          alias_note: '',
          flags: [
            { token: '-name "*.log"', meaning: 'match by file name pattern' },
            { token: '-mtime +7', meaning: 'modified more than 7 days ago' },
          ],
        },
        { name: 'xargs', meaning: 'passes its input as arguments to another command', alias_note: '', flags: [] },
        {
          name: 'rm',
          meaning: "removes files (they don't go to the Trash)",
          alias_note: '',
          flags: [{ token: '-f', meaning: 'force: no prompts, no error if a file is missing' }],
        },
      ],
      symbols: [{ token: '|', meaning: 'pipe: sends the output of the left command into the right one' }],
    },
    steps: [
      { snippet: 'find . -name "*.log" -mtime +7', explanation: 'Lists every .log file older than 7 days.', kind: 'step' },
      { snippet: '|', explanation: 'sends that list to step 2', kind: 'joiner' },
      { snippet: 'xargs rm -f', explanation: 'Deletes every file in the list, without asking.', kind: 'step' },
    ],
    risks: {
      data_loss: {
        level: 'high',
        findings: [
          finding(),
          finding({
            reason: 'File names with spaces are split apart by xargs.',
            certainty: 'possible',
            depends_on: '',
            how_to_verify: 'Run the find part on its own first.',
            snippet: 'xargs',
            source: 'ai',
            ruleId: undefined,
          }),
        ],
      },
      system_changes: none(),
      network: none(),
      elevated_rights: none(),
      hidden_behaviour: none(),
    },
    overall: 'high',
    ...over,
  };
}

export function notACommand(): FinalAnalysis {
  return findXargs({
    is_command: false,
    not_a_command_message: 'This looks like a sentence, not a command.',
    headline: '',
    what_it_does: '',
    glossary: { commands: [], symbols: [] },
    steps: [],
    risks: { data_loss: none(), system_changes: none(), network: none(), elevated_rights: none(), hidden_behaviour: none() },
    overall: 'none',
    shell: { name: 'unknown', confidence: 'low', note: '' },
  });
}

export function rulesOnlyResult(): FinalAnalysis {
  return findXargs({
    what_it_does: '',
    glossary: { commands: [], symbols: [] },
    steps: [],
    shell: { name: 'unknown', confidence: 'low', note: '' },
    headline: 'Deletes every file in the list it receives.',
    risks: { ...findXargs().risks, data_loss: { level: 'high', findings: [finding()] } },
    model_error: 'throttled',
  });
}
