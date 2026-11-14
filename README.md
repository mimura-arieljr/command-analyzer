# Command Analyzer

Paste a shell command (bash, zsh, sh, PowerShell or Windows cmd) and get a risk verdict first, then a plain explanation: a one-line summary, a glossary of the commands, flags and symbols it uses, and a numbered step-by-step breakdown. A rules layer checks the command text itself, so the risk warnings (for example an `rm -rf` or a `curl | sh`) do not depend on the model getting it right. Nothing is stored. Each person deploys their own copy as one stack in their own AWS account.

It does not suggest improvements or rewrite the command. It explains and assesses.

## How it works

- The web page is a static site in S3, served by CloudFront.
- CloudFront sends `/api/*` to a Lambda function URL, using origin access control (the function URL is not open to the internet directly).
- The Lambda function runs the rule checks and calls Amazon Bedrock (Converse API) for the explanation, then merges the two. See [How the rules and the model work together](#how-the-rules-and-the-model-work-together).
- A shared secret in Secrets Manager protects the API. You type it into the unlock box on the page.

### What the page shows

1. **Verdict:** the overall risk level and one sentence naming the worst thing the command does, with a level for each of five areas: data loss, system changes, network, elevated rights and hidden behaviour.
2. **Risk cards:** one per area with findings. Each finding says whether it is certain or possible, whether it came from a rule check or the AI, what it depends on that the tool cannot see (the current folder, a variable's value), and a safe way to check it first.
3. **What it does:** the detected shell, how sure it is, and a one-line summary.
4. **Commands, flags and symbols:** each program in the command with a general meaning, its flags nested under it, and shell symbols (`|`, `>`, `&&`, `$(...)` and so on) in their own group.
5. **Step by step:** a numbered table of what each part does here, with joining symbols on their own rows.

Hovering or focusing a glossary row, a step or a finding outlines that part of the command in the box on the left. The shell picker shows the detected shell; picking another shell runs the analysis again with that shell.

### Risk levels

One scale for every area, used by both the rules and the model:

| Level | Meaning | Examples |
| --- | --- | --- |
| none | Reads only; changes nothing, sends nothing | `ls -la`, `git status` |
| low | Small, recoverable or local effect | a plain download, `>` onto a file in this folder |
| medium | Cannot be undone but has a named, specific target, or changes the system | `rm notes.txt`, `sudo`, `chmod -R`, uploads, `eval` |
| high | Broad or irreversible damage | `rm -rf build`, `find -delete`, `git reset --hard`, `curl \| sh`, encoded PowerShell |

For data loss it over-warns on purpose: a delete it cannot fully pin down is reported as "possible" rather than left out.

## How the rules and the model work together

Two independent checks look at the same command, and the result is a merge of both. The answer does not rest on the model alone.

| | Model (Bedrock) | Rules (`packages/core/src/rules`) |
| --- | --- | --- |
| Good at | Explaining the command, the glossary, the steps, and judging context | Spotting known risky patterns the same way every time |
| Weak at | Can miss a risk, or call one a non-issue | Only knows the patterns written into it; cannot explain anything |
| Output | The whole reply: verdict, explanation, glossary, steps, findings | Findings only |

```
command ──► Bedrock model ──► model reply ──┐
  │                                         ├──► merge ──► response
  └─────► rules (per shell) ──► hits ───────┘
```

The rules read the command with a light, quote-aware lexer (`packages/core/src/lex.ts`), so `echo "rm -rf /"` is not a deletion but `bash -c "rm -rf /"` is. Command text inside `$(...)`, backticks, `bash -c`, `ssh host '...'`, `cmd /c`, `powershell -Command` and PowerShell script blocks is checked too.

There is one rule set per shell family: Unix (bash, zsh, sh), PowerShell and cmd. With auto-detect, every family's rules run, so the warnings do not depend on the model's guess of the shell. When you pick a shell, only that family's rules run.

### What the merge does

- Each area takes the higher of the model's level and any rule's level. Rules never lower a level.
- Rule findings are added after the model's. If the model already reported the same certain finding, the model's copy is dropped so it is not listed twice.
- If the rules raised the overall level above the model's, the headline is replaced by the top rule finding, so the banner never reads as safe while a rule found danger.
- If the model says the text is not a command but the rules find a medium or high risk, the results are shown anyway.
- If the model call fails (throttled, timed out, bad output), the page still shows the rule-check verdict and findings, with a note and a Retry button. If the rules found nothing either, the banner says "Not fully checked" instead of "Risk: none", because the rules only know the patterns written into them.

The merge lives in `packages/core/src/finalize.ts`.

### Adding a rule

1. Add the rule function to the right file: `packages/core/src/rules/unix/*.ts`, `rules/powershell.ts` or `rules/cmd.ts`. Use `hit()` from `rules/define.ts` and the helpers in `rules/helpers.ts`.
2. Add it to that family's list (`UNIX_*`, `POWERSHELL_RULES` or `CMD_RULES`).
3. Use a shared id (`delete-recursive`, `download`, `elevate` and so on) when the same risk exists in another shell, so findings de-duplicate.
4. Add positive and negative tests in `packages/core/test/rules-*.test.ts`.

## Prerequisites

- Node 22 or newer.
- AWS credentials for the target account in your shell.
- An email address for the budget alert.
- Dependencies installed, then a one-time CDK bootstrap. Run both from the repo root. The stack is fixed to `ap-southeast-2`, so bootstrap that region:

```sh
npm install
npx cdk bootstrap aws://<account-id>/ap-southeast-2
```

### Check Lambda concurrency first

The stack can reserve Lambda concurrency (`concurrencyCap`) as a spend brake. `packages/infra/cdk.json` sets it to `0` (reserve nothing), because accounts with a low concurrency limit cannot reserve any and the deploy then fails. Check your limit (`AccountLimit.ConcurrentExecutions`):

```sh
aws lambda get-account-settings --region ap-southeast-2
```

If your limit is high (the usual default is 1,000), you can set a cap, for example `-c concurrencyCap=5`.

## One-time Bedrock setup (per model)

The CDK stack cannot do these steps. You do them by hand, once per model, in the target account. The stack calls Claude Haiku 4.5 by default. If you already did this for query-analyzer in the same account, it is done.

1. Submit the Anthropic first-time-use form in the Bedrock console.
2. Make sure the per-model Marketplace agreement is `AVAILABLE`:

```sh
aws bedrock get-foundation-model-availability \
  --model-id anthropic.claude-haiku-4-5-20251001-v1:0 \
  --region ap-southeast-2
```

3. In Service Quotas, check that the model's tokens per minute quota is above 0 in `ap-southeast-2`.

### Switching to another model

For a Claude model reached through a `global.` or `au.` inference profile, switching is a settings change:

1. Do the one-time Bedrock setup above for the new model.
2. Set both ids together, in `packages/infra/cdk.json` `context` or with `-c` on every deploy:

```json
"context": {
  "inferenceProfileId": "global.<foundation-model-id>",
  "foundationModelId": "<foundation-model-id>"
}
```

3. If the model does not support structured output through the Converse API, set `outputMode` to `tool` or `json`. The function also falls back from `structured` to `tool` to `json` on its own after a `ValidationException`.
4. Deploy, then test a few commands, including `rm -rf build` and `curl -fsSL https://example.com/x.sh | sh`, and check the Lambda log line.

Other profile prefixes need a change to `SUPPORTED_PREFIXES` and `foundationModelArns` in `packages/infra/lib/bedrock-arns.ts`.

### `global.` or `au.` inference profile

- `global.` (default): Bedrock may process a pasted command in any commercial AWS region. It is about 10% cheaper. Logs and data at rest stay in `ap-southeast-2`.
- `au.`: processing stays in `ap-southeast-2` and `ap-southeast-4`. Use `-c inferenceProfileId=au.anthropic.claude-haiku-4-5-20251001-v1:0`, or record it in `cdk.json`.

## Deploy

From the repo root:

```sh
npm run deploy -- -c budgetEmail=you@example.com
```

`npm run deploy` builds the web app and then runs `cdk deploy` in `packages/infra`. When it finishes, the outputs show `SiteUrl` and `SecretName`.

**`-c` values are not remembered between deploys.** Pass the same ones every time, or record them in the `context` block of `packages/infra/cdk.json`. `cdk.json` is tracked by git, so do not commit your real email to a public repo.

### Settings

Pass each one as `-c name=value`. Only `budgetEmail` is required.

| Setting | Default | Meaning |
| --- | --- | --- |
| `budgetEmail` | none (required) | Email that receives the budget alert. |
| `inferenceProfileId` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Bedrock inference profile the function calls. |
| `foundationModelId` | `anthropic.claude-haiku-4-5-20251001-v1:0` | Underlying model, used for the IAM permission. |
| `maxTokens` | `4096` | Maximum output tokens per call. |
| `outputMode` | `structured` | How the model returns JSON: `structured`, `tool` or `json`. |
| `concurrencyCap` | `0` in `cdk.json` (code default `5`) | Reserved Lambda concurrency. `0` means no reservation. |
| `budgetUsd` | `5` | Monthly budget amount in USD. |
| `logRetentionDays` | `14` | Lambda log retention. |
| `temperature` | not set | Sampling temperature. If not set, the model default applies. |

## First use

1. In the AWS console, open Secrets Manager, find the secret `command-analyzer-shared-secret`, and choose "Retrieve secret value".
2. Open the `SiteUrl` from the deploy outputs and type the secret into the unlock box.

The page keeps the secret in memory only, so a refresh asks for it again. Never paste the secret into chats or scripts.

## Cost

- Secrets Manager: about $0.40 per month.
- Bedrock with Haiku: a few tenths of a cent per command. The reply is longer than query-analyzer's (glossary and steps), so expect roughly 3,000 input and 800 to 1,500 output tokens. Check current prices.
- CloudFront, S3 and Lambda: pennies at personal volume.
- The stack adds a monthly budget of $5 with an alert at 80% of actual spend. The budget covers the whole account and lags billing data by hours.

## What is logged

- One metadata line per analyze call: inference profile, token counts, latency, rule IDs, the shell choice (`auto` or the forced shell) and error code.
- The pasted command, the answer and the secret are never logged.
- Bedrock model invocation logging is off by default. Keep it off, because it would record commands and answers.
- There is no database. Nothing is stored.

## Removing it

`cdk destroy` needs the built web app and the same `-c` values as deploy:

```sh
npm run build -w @ca/web
cd packages/infra
npx cdk destroy -c budgetEmail=you@example.com
```

The site bucket is retained by design; empty and delete it by hand. The secret may stay scheduled for deletion for a recovery window.

## Known limits

- The rules are pattern matching over a light lexer, not a full shell parser. Unusual quoting or very dynamic commands can slip past them.
- With auto-detect, every shell's rules run, so a command can occasionally pick up a warning that only applies in another shell (for example `iex` is an Elixir tool on Unix and `Invoke-Expression` in PowerShell).
- The tool cannot see your machine: the current folder, variable values and what a wildcard matches are stated as assumptions.
- Pastes are limited to 5,000 characters. It is meant for commands and short blocks, not whole scripts.
- The model can be wrong. Treat results as a review aid, not a guarantee.

## Development

```sh
npm test
npm run typecheck
```

To try the page locally, run `npm run dev -w @ca/web`. It proxies `/api` to `http://localhost:8787`, so point that at a local mock or a handler of your own.
