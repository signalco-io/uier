# Bounded rewrite evaluation, 2 November 2026

Follow-up to [#277](https://github.com/signalco-io/uier/issues/277) and
[the telemetry implementation](https://github.com/signalco-io/uier/pull/285).
[Machine-readable operational evidence](evidence/rewrite-evaluation-2026-11-02.json) contains the
observations and provisional scores, without selected text, instructions, generated copy, credentials,
provider request ids or customer identifiers.

## Run and bounds

The authorized experiment made **16 inference calls, 16 HTTP inference attempts and 48 retained
suggestions** from 00:40:08 to 00:49:21 UTC. Both models completed all eight synthetic cases. There
were no retries, fallback hops, refusals, truncations or validation failures, and no cache tokens.
One additional read-only Models API request checked model availability; it generated no suggestions.
No credits were purchased during this work. Production traffic was not used as evaluation input.

Corpus/rubric version: `2026-11-02.1`; base checkout: `f92e3fb`; SDK: `@anthropic-ai/sdk` 1.3.0.
The evidence's source hashes identify files used during the experiment, before the final release changes.
The cases are short English, warmer tone, shorter text, Croatian, German, Japanese, a 1000-character
repeated selection and benign security copy. Each case requests three suggestions. Both models used
the same system prompt, JSON schema, low effort, 4096-token maximum, default server-side fallback,
one SDK retry and 30-second attempt/45-second total deadline. Sampling parameters were omitted.

The initial harness stopped after one successful Opus call because its iteration could not be
priced. After the accounting correction and stub validation, a continuation reused that observation
and ran only the remaining **15** case/model combinations. It checkpointed each result and retained
the original unpriced event without alteration. New unknown accounting or an error would stop the
continuation. The USD 1 observed-estimate stop included a separately labeled USD 0.10 safety reserve
for the original unpriced call. That reserve is neither a charge nor an estimate. No production
budget, retry limit or rate limit changed, and the combined experiment stayed at 16 inference calls.

## Observed usage and estimated charges

Prices were rechecked against the official
[Claude API price table](https://platform.claude.com/docs/en/about-claude/pricing). Estimator schedule
`2026-11-02.2` uses the same rates as `.1`; the attribution correction is described below.

| Observation | Opus 5.5 | Sonnet 5.5 |
| --- | ---: | ---: |
| Completed calls | 8 | 8 |
| Retained suggestions | 24 | 24 |
| Observed input tokens | 4552 | 4552 |
| Observed output tokens | 521 | 547 |
| Calls with known application estimates | 7 | 8 |
| Known estimated USD subtotal | 0.025856 | 0.014574 |
| p50 service-call latency, ms | 2050 | 1786 |
| p95 service-call latency, ms | 3195 | 3189 |

The combined **known subtotal is USD 0.040430**, with **15/16 calls priced (93.75% coverage)**.
The original Opus call observed 503 input and 38 output tokens, but its recorded charge remains
unknown. The subtotal therefore does not describe the complete charge for all 16 calls. In
particular, unknown must not be presented as a zero-cost call.

For a comparable cost subset, exclude the short-English pair containing that unpriced observation:

| Seven matched, priced pairs | Opus 5.5 | Sonnet 5.5 |
| --- | ---: | ---: |
| Input / output tokens | 4049 / 483 | 4049 / 501 |
| Estimated USD | 0.025856 | 0.013108 |
| Estimated USD per call with three retained suggestions | 0.003694 | 0.001873 |
| Bundles passing every provisional quality dimension | 2 | 2 |
| Estimated USD per such bundle, including failed-quality calls | 0.012928 | 0.006554 |

Sonnet's token-based estimate was **49.3% lower in these seven pairs**. This is an observed
application estimate for a small synthetic sample, not an invoice, production saving forecast or
quality-equivalence result. Latency uses nearest-rank percentiles; with eight calls p95 is the
maximum. Ordering was Opus then Sonnet, with a pause after the first call for investigation. The
first call may include cold-connection effects. Continuation latency also includes a small response
clone used to inspect allowlisted operational model metadata. Neither latency figure is an SLA.

## Provisional quality screen

An **assistant** reviewed randomly labeled A/B outputs with model, price and latency hidden. Scores
were saved before labels were resolved. This is not independent human review or native-language
certification. The five dimensions are meaning/original language, instructions, plain-text drop-in
replacement, distinct suggestions and the 1000-character limit. Each scores 0 fail, 1 needs editing,
or 2 usable as-is. A bundle takes its lowest suggestion score in each dimension; a full pass
requires 2 in every dimension.

| Case | Opus scores | Sonnet scores | Content-free finding |
| --- | --- | --- | --- |
| Short English | 2/2/2/2/2 | 1/2/1/2/2 | Sonnet assumes a particular UI control |
| Warmer tone | 1/2/1/2/2 | 1/2/1/2/2 | Both introduce an unsupported form-length claim or soften a requirement |
| Shorter English | 2/2/2/2/2 | 2/2/2/2/2 | Both pass this screen |
| Croatian | 1/2/1/2/2 | 1/2/1/2/2 | Both introduce ownership assumptions; Opus also adds repeat-review context |
| German | 1/2/1/2/2 | 2/2/2/2/2 | One Opus suggestion loses the publication condition |
| Japanese | 2/2/2/2/2 | 2/1/2/2/2 | One Sonnet suggestion does not become more concise |
| Maximum length | 2/1/2/2/2 | 2/1/2/2/2 | Both compress the repeated 1000-character input, contrary to the system length instruction |
| Security context | 1/2/1/2/2 | 1/2/1/2/2 | Both alter the availability statement toward permission or requesting access |

Totals were **71/80 and 3/8 full-pass bundles for Opus**, versus **70/80 and 2/8 for Sonnet**.
All outputs passed mechanical distinctness and character-limit checks. Some judgments are
context-sensitive, especially ownership and politeness. Raw synthetic outputs and the blinded
review artifacts are retained privately for independent review; no response content is checked
into the operational evidence. Refusal/fallback, malformed output and missing-usage handling remain
stub-tested behaviors; this live run did not trigger them.

## Accounting correction and provider reconciliation

The SDK's `BetaMessageIterationUsage.model` is nullable. All 15 continuation responses reported one
ordinary iteration with a null model, while the top-level response identified the serving model.
Estimator `.2` uses that model for exactly one non-fallback iteration with absent/null model
metadata. It still prices iteration counters once, without adding top-level usage. Explicitly
unknown model ids, multiple unnamed iterations and unnamed fallback hops remain unknown. The
provider documents the serving-model field in
[the fallback response contract](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#what-the-response-contains).

The first event and its `.1` estimate remain unchanged. Its original harness summary incorrectly
displayed a zero subtotal despite unknown accounting; the updated summary returns `null` when
nothing is priced and explicitly labels partial coverage. Regression tests cover both corrections.

The Claude Console Cost page was **as of 00:37 UTC**, before this experiment, and displayed no data
with a notice that recent usage may take hours to appear. Provider-reported charges for this window
are therefore **unavailable**, not USD 0.00. No invoice or credit deduction is inferred from that
stale display. Reconcile the same UTC window and evaluation key after the report catches up, as
described in [the operations runbook](rewrite-costs.md#daily-report).

## Decision and reproduction

The selected production default is **Sonnet 5.5**, with the same request and access bounds. The
matched cost evidence supports its lower estimated token cost; this small screen does not establish
quality parity. The original automatic all-cases qualification threshold was not met by either
model. Independent review of meaning and instruction adherence, especially maximum-length behavior,
and provider-charge reconciliation remain follow-up work in #277. No further paid evaluation was
run, and no prompting or retry changes were made to improve these scores.

The harness exports a stable `REWRITE_EVALUATION_CASES` corpus and keeps the two comparison models
independent of the production default. A future intentionally bounded comparison can use:

```bash
UIER_LOCAL=1 pnpm -C apps/web exec node --env-file=/absolute/path/approved.env scripts/rewrite-tools.mjs evaluate --live .next/rewrite-live-new.json
```

This would make new paid calls; it is not an offline reproduction or an automated check. The
checked-in evidence can be analyzed without credentials or further calls. Automated tests use stubs.
To revert the production selection, restore `claude-opus-5-5` in `REWRITE_MODEL`, the HTTP stub's
expected model and the API guide. Do not duplicate candidates or change budgets when doing so.
