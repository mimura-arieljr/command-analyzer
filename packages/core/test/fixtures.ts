import type { ModelAnalysis } from '../src/types';

const emptyArea = () => ({ level: 'none' as const, findings: [] });

// A full model reply for `find . -name "*.log" -mtime +7 | xargs rm -f`.
export function findXargsModel(): ModelAnalysis {
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
      {
        snippet: 'find . -name "*.log" -mtime +7',
        explanation: 'Lists every .log file under the current folder last changed more than 7 days ago.',
        kind: 'step',
      },
      { snippet: '|', explanation: 'sends that list to step 2', kind: 'joiner' },
      { snippet: 'xargs rm -f', explanation: 'Deletes every file in the list, without asking.', kind: 'step' },
    ],
    risks: {
      data_loss: {
        level: 'high',
        findings: [
          {
            reason: 'rm -f deletes without asking. The files skip the Trash and cannot be recovered.',
            certainty: 'certain',
            depends_on: 'the folder you run it in',
            how_to_verify: '',
            snippet: 'xargs rm -f',
          },
        ],
      },
      system_changes: emptyArea(),
      network: emptyArea(),
      elevated_rights: emptyArea(),
      hidden_behaviour: emptyArea(),
    },
  };
}

export function notACommandModel(): ModelAnalysis {
  return {
    is_command: false,
    not_a_command_message: 'This looks like a sentence, not a command.',
    shell: { name: 'unknown', confidence: 'low', note: '' },
    headline: '',
    what_it_does: '',
    glossary: { commands: [], symbols: [] },
    steps: [],
    risks: {
      data_loss: emptyArea(),
      system_changes: emptyArea(),
      network: emptyArea(),
      elevated_rights: emptyArea(),
      hidden_behaviour: emptyArea(),
    },
  };
}
