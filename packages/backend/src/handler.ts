import { createHash, timingSafeEqual } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { finalize, rulesOnly, runRules, type AnalyzeResponse, type ErrorCode, type RuleHit, type Shell } from '@ca/core';
import { AnalyzeError, analyzeWithBedrock, createBedrockClient, type BedrockConfig, type OutputMode } from './bedrock';
import { prepareRequest } from './prompt';

export interface HandlerDeps {
  getSecret: () => Promise<string>;
  analyze: (command: string, shell?: Shell) => ReturnType<typeof analyzeWithBedrock>;
  log: (line: object) => void;
  // Inference profile id, for the log line only.
  profile?: string;
}

export interface HandlerResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type LambdaHandler = (event: APIGatewayProxyEventV2) => Promise<HandlerResult>;

const STATUS: Record<ErrorCode, number> = {
  empty: 400,
  too_long: 400,
  bad_request: 400,
  unauthorized: 401,
  throttled: 429,
  bad_output: 502,
  failed: 500,
};

// Fixed text per code: never an exception message.
const MESSAGE: Record<ErrorCode, string> = {
  empty: 'Paste a command to analyze.',
  too_long: 'That command is too long (limit 5,000 characters).',
  bad_request: 'That request was not valid.',
  unauthorized: 'Wrong or missing secret.',
  throttled: 'Too many requests. Wait a moment and try again.',
  bad_output: "Couldn't analyse that. Try again.",
  failed: "Couldn't analyse that. Try again.",
};

const BASE_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function respond(statusCode: number, response?: AnalyzeResponse, extra: Record<string, string> = {}): HandlerResult {
  return { statusCode, headers: { ...BASE_HEADERS, ...extra }, body: response ? JSON.stringify(response) : '' };
}

function fail(error: ErrorCode, extra?: Record<string, string>): HandlerResult {
  return respond(STATUS[error], { ok: false, error, message: MESSAGE[error] }, extra);
}

// Hash both sides so the buffers always have equal length (no length leak, no throw).
function secretMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  const raw = event.body ?? '';
  return JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
}

// A bug in a rule must not take the whole analysis down.
function safeRules(command: string, shell?: Shell): RuleHit[] {
  try {
    return runRules(command, shell);
  } catch {
    return [];
  }
}

function errorCodeOf(e: unknown): ErrorCode {
  return e instanceof AnalyzeError ? e.code : 'failed';
}

export function createHandler(deps: HandlerDeps): LambdaHandler {
  async function analyzeRoute(event: APIGatewayProxyEventV2): Promise<HandlerResult> {
    let ruleIds: string[] = [];
    let shellLabel = 'auto';
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;
    let errorCode: ErrorCode | undefined;
    let result: HandlerResult;
    try {
      let parsed: unknown;
      try {
        parsed = parseBody(event);
      } catch {
        throw new AnalyzeError('bad_request');
      }
      const prepared = prepareRequest(parsed);
      if (!prepared.ok) throw new AnalyzeError(prepared.error);
      const { command, shell } = prepared;
      shellLabel = shell ?? 'auto';
      const hits = safeRules(command, shell);
      ruleIds = [...new Set(hits.map((h) => h.id))].sort();
      try {
        const res = await deps.analyze(command, shell);
        inputTokens = res.usage.inputTokens;
        outputTokens = res.usage.outputTokens;
        latencyMs = res.latencyMs;
        result = respond(200, { ok: true, analysis: finalize(res.analysis, hits, { shell }) });
      } catch (e) {
        // The model failed: the rule checks still answer.
        errorCode = errorCodeOf(e);
        result = respond(200, { ok: true, analysis: rulesOnly(hits, errorCode, { shell }) });
      }
    } catch (e) {
      errorCode = errorCodeOf(e);
      result = fail(errorCode);
    }
    deps.log({
      event: 'analyze',
      profile: deps.profile ?? 'unknown',
      inputTokens,
      outputTokens,
      latencyMs,
      ruleIds,
      shell: shellLabel,
      ...(errorCode && { errorCode }),
    });
    return result;
  }

  return async (event) => {
    const path = event.rawPath;
    const method = event.requestContext.http.method.toUpperCase();
    const route =
      path === '/api/check' ? { method: 'GET' } : path === '/api/analyze' ? { method: 'POST' } : undefined;
    if (!route) return respond(404);
    if (method !== route.method) return respond(405, undefined, { allow: route.method });

    let expected: string;
    try {
      expected = await deps.getSecret();
    } catch {
      return fail('failed');
    }
    // An empty or non-string secret must never authenticate.
    if (typeof expected !== 'string' || expected === '') return fail('failed');
    if (!secretMatches(event.headers?.['x-app-secret'] ?? '', expected)) return fail('unauthorized');

    if (path === '/api/check') return respond(204);
    return analyzeRoute(event);
  };
}

// Real wiring: built on first use, so importing this module reads no env and calls no AWS.
function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`bad ${name}`);
  return n;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function outputMode(): OutputMode {
  const v = process.env.OUTPUT_MODE ?? 'structured';
  if (v !== 'structured' && v !== 'tool' && v !== 'json') throw new Error('bad OUTPUT_MODE');
  return v;
}

function buildRealHandler(): LambdaHandler {
  const secretArn = required('SECRET_ARN');
  const cfg: BedrockConfig = {
    profileId: required('INFERENCE_PROFILE_ID'),
    maxTokens: positiveInt('MAX_TOKENS', 4096),
    outputMode: outputMode(),
    timeoutMs: positiveInt('REQUEST_TIMEOUT_MS', 25000),
  };
  if (process.env.TEMPERATURE) {
    const t = Number(process.env.TEMPERATURE);
    if (!Number.isFinite(t)) throw new Error('bad TEMPERATURE');
    cfg.temperature = t;
  }
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const bedrock = createBedrockClient(region);
  const secrets = new SecretsManagerClient({ region });
  let cached: Promise<string> | undefined;
  // Read once per container; a failed read is not cached.
  const getSecret = () => {
    cached ??= secrets
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((r) => {
        if (!r.SecretString) throw new Error('empty secret');
        return r.SecretString;
      })
      .catch((e: unknown) => {
        cached = undefined;
        throw e;
      });
    return cached;
  };
  return createHandler({
    getSecret,
    analyze: (command, shell) => analyzeWithBedrock(bedrock, cfg, command, shell),
    log: (line) => console.log(JSON.stringify(line)),
    profile: cfg.profileId,
  });
}

let real: LambdaHandler | undefined;

export const handler: LambdaHandler = async (event) => {
  try {
    real ??= buildRealHandler();
  } catch {
    console.log(JSON.stringify({ event: 'config_error' }));
    return fail('failed');
  }
  return real(event);
};
