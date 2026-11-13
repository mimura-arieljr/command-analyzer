import { describe, expect, it } from 'vitest';
import { SchemaError, validateAnalysis } from '../src/schema';
import { findXargsModel } from './fixtures';

describe('validateAnalysis', () => {
  it('accepts a full valid analysis', () => {
    const value = findXargsModel();
    expect(validateAnalysis(value)).toEqual(value);
  });

  it('rejects a missing area', () => {
    const value = findXargsModel() as unknown as { risks: Record<string, unknown> };
    delete value.risks.network;
    expect(() => validateAnalysis(value)).toThrow(SchemaError);
  });

  it('rejects an improvements field', () => {
    const value = { ...findXargsModel(), improvements: ['use -print0'] };
    expect(() => validateAnalysis(value)).toThrow(SchemaError);
  });

  it('rejects an unknown shell name', () => {
    const value = findXargsModel() as unknown as { shell: { name: string } };
    value.shell.name = 'fish';
    expect(() => validateAnalysis(value)).toThrow(SchemaError);
  });
});
