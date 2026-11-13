import Ajv from 'ajv/dist/2020';
import type { ModelAnalysis } from './types';

const LEVEL = { type: 'string', enum: ['none', 'low', 'medium', 'high'] } as const;
const AREA_REF = { $ref: '#/$defs/area' } as const;

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_command',
    'not_a_command_message',
    'shell',
    'headline',
    'what_it_does',
    'glossary',
    'steps',
    'risks',
  ],
  properties: {
    is_command: { type: 'boolean' },
    not_a_command_message: { type: 'string' },
    shell: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'confidence', 'note'],
      properties: {
        name: { type: 'string', enum: ['bash', 'zsh', 'sh', 'powershell', 'cmd', 'unknown'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        note: { type: 'string' },
      },
    },
    headline: { type: 'string' },
    what_it_does: { type: 'string' },
    glossary: {
      type: 'object',
      additionalProperties: false,
      required: ['commands', 'symbols'],
      properties: {
        commands: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'meaning', 'alias_note', 'flags'],
            properties: {
              name: { type: 'string' },
              meaning: { type: 'string' },
              alias_note: { type: 'string' },
              flags: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['token', 'meaning'],
                  properties: { token: { type: 'string' }, meaning: { type: 'string' } },
                },
              },
            },
          },
        },
        symbols: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['token', 'meaning'],
            properties: { token: { type: 'string' }, meaning: { type: 'string' } },
          },
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['snippet', 'explanation', 'kind'],
        properties: {
          snippet: { type: 'string' },
          explanation: { type: 'string' },
          kind: { type: 'string', enum: ['step', 'joiner'] },
        },
      },
    },
    risks: {
      type: 'object',
      additionalProperties: false,
      required: ['data_loss', 'system_changes', 'network', 'elevated_rights', 'hidden_behaviour'],
      properties: {
        data_loss: AREA_REF,
        system_changes: AREA_REF,
        network: AREA_REF,
        elevated_rights: AREA_REF,
        hidden_behaviour: AREA_REF,
      },
    },
  },
  $defs: {
    finding: {
      type: 'object',
      additionalProperties: false,
      required: ['reason', 'certainty', 'depends_on', 'how_to_verify', 'snippet'],
      properties: {
        reason: { type: 'string' },
        certainty: { type: 'string', enum: ['certain', 'possible'] },
        depends_on: { type: 'string' },
        how_to_verify: { type: 'string' },
        snippet: { type: 'string' },
      },
    },
    area: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'findings'],
      properties: {
        level: LEVEL,
        findings: { type: 'array', items: { $ref: '#/$defs/finding' } },
      },
    },
  },
} as const;

export class SchemaError extends Error {
  constructor(readonly details: string) {
    super(`Analysis failed schema validation: ${details}`);
    this.name = 'SchemaError';
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(ANALYSIS_SCHEMA);

export function validateAnalysis(value: unknown): ModelAnalysis {
  if (!validate(value)) {
    throw new SchemaError(ajv.errorsText(validate.errors));
  }
  return value as ModelAnalysis;
}
