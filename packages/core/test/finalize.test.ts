import { describe, expect, it } from 'vitest';
import { finalize, RULES_CLEAN_HEADLINE, rulesOnly } from '../src/finalize';
import type { RuleHit } from '../src/rules';
import { findXargsModel, notACommandModel } from './fixtures';

function ruleHit(over: Partial<RuleHit> = {}): RuleHit {
  return {
    id: 'delete-recursive',
    area: 'data_loss',
    level: 'high',
    certainty: 'certain',
    reason: 'Deletes build and everything inside. Files removed this way skip the Trash.',
    depends_on: '',
    how_to_verify: '',
    snippet: 'rm -rf build',
    matchesModel: /delet/i,
    ...over,
  };
}

describe('finalize', () => {
  it('takes the higher level per area', () => {
    const model = findXargsModel();
    const out = finalize(model, [ruleHit({ area: 'network', id: 'download', level: 'low', matchesModel: /download/i })]);
    expect(out.risks.network.level).toBe('low');
    expect(out.risks.data_loss.level).toBe('high');
    expect(out.overall).toBe('high');
  });

  it('adds rule findings after model findings', () => {
    const model = findXargsModel();
    model.risks.data_loss.findings[0].certainty = 'possible';
    const out = finalize(model, [ruleHit()]);
    expect(out.risks.data_loss.findings.map((f) => f.source)).toEqual(['ai', 'rule']);
    expect(out.risks.data_loss.findings[1].ruleId).toBe('delete-recursive');
  });

  it('drops a certain duplicate once', () => {
    const model = findXargsModel();
    model.risks.data_loss.findings.push({ ...model.risks.data_loss.findings[0], reason: 'Also deletes logs.' });
    const out = finalize(model, [ruleHit()]);
    // Two certain model findings match /delet/; one hit drops only the first.
    expect(out.risks.data_loss.findings.map((f) => f.source)).toEqual(['ai', 'rule']);
    expect(out.risks.data_loss.findings[0].reason).toBe('Also deletes logs.');
  });

  it('keeps possible model findings', () => {
    const model = findXargsModel();
    model.risks.data_loss.findings[0].certainty = 'possible';
    const out = finalize(model, [ruleHit()]);
    expect(out.risks.data_loss.findings).toHaveLength(2);
  });

  it('replaces the headline when rules raise the overall level', () => {
    const model = findXargsModel();
    model.risks.data_loss = { level: 'low', findings: [] };
    const out = finalize(model, [ruleHit()]);
    expect(out.overall).toBe('high');
    expect(out.headline).toBe(ruleHit().reason);
  });

  it('keeps the model headline when rules do not raise it', () => {
    const out = finalize(findXargsModel(), [ruleHit()]);
    expect(out.headline).toBe(findXargsModel().headline);
  });

  it('not a command with a high hit becomes a result', () => {
    const out = finalize(notACommandModel(), [ruleHit()]);
    expect(out.is_command).toBe(true);
    expect(out.not_a_command_message).toBe('');
    expect(out.headline).toBe(ruleHit().reason);
    expect(out.overall).toBe('high');
  });

  it('not a command with only a low hit stays not a command', () => {
    const out = finalize(notACommandModel(), [ruleHit({ level: 'low', id: 'overwrite-redirect' })]);
    expect(out.is_command).toBe(false);
  });

  it('forced shell overrides the model', () => {
    const out = finalize(findXargsModel(), [], { shell: 'zsh' });
    expect(out.shell).toEqual({ name: 'zsh', confidence: 'high', note: '' });
  });

  it('never lowers a level', () => {
    const out = finalize(findXargsModel(), [ruleHit({ level: 'low' })]);
    expect(out.risks.data_loss.level).toBe('high');
  });
});

describe('rulesOnly', () => {
  it('sets model_error and the clean headline when there are no hits', () => {
    const out = rulesOnly([], 'throttled');
    expect(out.model_error).toBe('throttled');
    expect(out.headline).toBe(RULES_CLEAN_HEADLINE);
    expect(out.headline).toMatch(/Only the rule checks ran/);
    expect(out.headline).toMatch(/does not mean it is safe/);
    expect(out.overall).toBe('none');
    expect(out.is_command).toBe(true);
    expect(out.glossary).toEqual({ commands: [], symbols: [] });
    expect(out.steps).toEqual([]);
    expect(out.shell.name).toBe('unknown');
  });

  it('uses the top hit for the headline and fills its area', () => {
    const out = rulesOnly([ruleHit({ level: 'medium', id: 'delete-file', reason: 'Deletes notes.txt.' }), ruleHit()], 'failed', { shell: 'bash' });
    expect(out.headline).toBe(ruleHit().reason);
    expect(out.risks.data_loss.level).toBe('high');
    expect(out.risks.data_loss.findings).toHaveLength(2);
    expect(out.shell.name).toBe('bash');
  });
});
