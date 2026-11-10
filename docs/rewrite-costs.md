# Rewrite usage, cost estimates and model evaluation

Tracking: [#277](https://github.com/signalco-io/uier/issues/277). The selected production default is
`claude-sonnet-5-5`. The [bounded live comparison](rewrite-evaluation-2026-11-02.md) records measured token
usage, provisional quality findings and the remaining provider-charge reconciliation gap.

## Baseline and evidence gap, 2 November 2026

Baseline period requested for reconciliation: **1 November 2026, 00:00–23:37 UTC (investigation cutoff)**. No historical
rewrite usage export or Anthropic invoice/Cost Report is available in this session. Before this
change the service did not retain usage. Observed production calls, tokens, charges and cost per
usable result for that period are **unknown**, not zero. Hosting charges cannot establish AI spending.

At the original investigation cutoff, the local process had neither `ANTHROPIC_API_KEY` nor
`ANTHROPIC_ADMIN_KEY`, and no local environment file supplied them. GitHub's repository-secret listing
did not include `ANTHROPIC_API_KEY`. The connected Vercel account and its available team returned no
uier project. None of this proves there was no historical spending. The later production setup uses
GitHub's `production` environment secret, passed through the existing Pulumi deployment.
No live evaluation had run at that cutoff. A later authorized 16-call run is recorded in the
[live evaluation evidence](rewrite-evaluation-2026-11-02.md). Historical production charges remain
unknown; independent quality review and provider-charge reconciliation remain follow-up work.

## Operational events

Both rewrite routes call `src/lib/rewrite/suggest.ts`, and so do both page suggestion routes
([page suggestions](api.md#page-suggestions), through the same `createSuggestionCall`). After a configured call completes, its
`finally` block emits **one** JSON `rewrite_usage` v1 event through existing server logs; a page
suggestion's event adds `feature: "page_suggestions"`, so daily reports include both and can tell them apart. Events
carry a random call id solely for deduplicating repeated log exports, UTC timestamp, deployment
environment, allowlisted requested/returned model, fallback flag, observed SDK HTTP-attempt count,
duration, bounded stop reason, retained suggestion count, outcome, token counters and versioned estimate.
No event is emitted for pre-provider authorization, validation, configuration or budget rejections;
this is service-call accounting, not total HTTP traffic or a rate-limit ledger.

Outcomes are `success`, `refusal`, `truncation`, `invalid_output`, `empty_output`, `filtered_out`,
`timeout` and `provider_error`. A response with zero useful suggestions still records its usage.
Success means at least one suggestion passed existing validation; it does not certify semantic quality.

No selected text, instruction, generated text, URL/domain, customer/project/reviewer/IP identifier,
provider request/message id, secret, raw exception or refusal explanation is copied into these events.
Unknown provider model strings become `unknown`. SDK payload logging is explicitly off. A throwing
telemetry sink cannot change a rewrite's result. Delivery is best effort: platform log loss, sampling,
export omissions or process termination can leave gaps. Logs use existing hosting retention; no drain,
database, paid product or retention extension is provisioned. Export operational events before that
retention expires. Hosting's own request metadata is separate from the fields emitted by this code.

## Prices and accounting

`apps/web/src/lib/rewrite/pricing.ts` is the maintained rate table. Version **2026-11-02.2** is an
estimate schedule checked on 2 November 2026 against the official
[Claude API price table](https://platform.claude.com/docs/en/about-claude/pricing).
It applies standard synchronous global USD rates: Opus 5.5 input/output **4/20**, Sonnet 5.5 **2/10**
per million tokens. Cache creation has distinct five-minute/one-hour rates; cache reads have their
own rate. The source table in code includes those rates. US inference applies the documented 1.1
multiplier. Missing tier/speed/geography metadata, batch, priority, fast mode, other geographies and explicit fallback-credit usage are
unsupported pricing, so their observed tokens are retained with unknown charges.

- Input, output, cache reads and cache writes are separate counters. Output already includes
  thinking; its breakdown must not be added again. Cache writes use the TTL breakdown, never both
  the aggregate and its parts. Nonzero cache writes without a matching breakdown have unknown cost.
- When `usage.iterations` exists, use its entries instead of adding top-level usage. Top-level usage
  represents the final attempt, not the whole fallback chain. The SDK permits a null ordinary
  iteration model: one non-fallback iteration can use the serving response model. Explicitly unknown
  models, multiple unnamed iterations and unnamed fallback hops remain unknown. Version 2026-11-02.2
  adds this attribution without changing rates or silently repricing historical events. See the official
  [fallback usage and billing contract](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#billing-and-rate-limits).
- The fetch wrapper counts actual SDK HTTP attempts without emitting a second outcome event. A
  retried call lacks the earlier HTTP attempt's usage; its final estimate is **partial** even when
  the final response succeeded. A failed call without usage is **unknown**. Existing one-retry,
  30-second attempt/45-second total timeout, default fallback and budgets are unchanged.
- Every fallback is partial because credits/repricing cannot be reconciled from token counters
  alone. Earlier zero-output fallback hops also lack per-hop refusal categories, so their charge
  remains unknown. Missing iteration records or unsupported iteration types are explicit gaps.
- For a terminal zero-output refusal, only documented billing categories are recognized. `bio`,
  `frontier_llm` and `reasoning_extraction` are priced; `cyber`, `general_harms` and explicit null
  categories have zero estimated charge. Unknown categories have unknown charges. Nonzero output
  is priced normally. Update this policy with the provider's refusal-billing documentation.
- Only explicitly listed model ids have rates; aliases/new fallback models remain unknown until
  checked. No rate is inferred from a model name. Missing counters are null, never silently zero.

`known` means all observed token categories for this call have supported rates, not that the invoice
is known. `partial` means a supported portion has an estimate plus explicit gaps. `unknown` has null
cost. Estimates with fallback adjustments are not guaranteed lower bounds. Taxes, discounts, credits,
unobserved retries and unrelated traffic can make provider charges differ in either direction.

When prices change, add a new schedule version/date and authoritative source, update supported
models and deterministic fixtures, and keep historical event estimates with their original version.
Do not silently reprice old events. Review new usage fields and refusal/fallback rules with an SDK update.

## Daily report

Export the existing hosting logs as NDJSON, retaining complete JSON messages containing
`"event":"rewrite_usage"`. The tool accepts raw events or Vercel log objects with a `message`
string containing an event. Supply a UTC day and one environment:

```bash
pnpm -C apps/web exec node scripts/rewrite-tools.mjs report /absolute/path/rewrite-logs.ndjson 2026-11-01 production
```

The JSON report separates observed calls/outcomes and SDK attempts, known token totals and missing
counters, estimated USD and cost per usable call/suggestion, p50/p95 call latency, pricing versions,
known/partial/unknown coverage and limitation counts. It deduplicates call ids, reports rejected event
records and never outputs raw log messages. All costs and latency are null when no observations exist.
Per-result estimates divide the observed estimated subtotal (including unsuccessful calls) by all
observed usable calls/suggestions: with incomplete coverage these ratios are incomplete too.
Missing-usage calls add no invented tokens. Cache aggregate and TTL totals are alternative views.

`providerCharges` deliberately remains `{ "status": "unavailable", "usd": null }`. To reconcile,
obtain the matching UTC daily Usage/Cost Report with an authorized Anthropic admin credential or console
export. See [Usage and Cost API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api).
Compare the same environment/API-key scope, time window, model ids, token categories and currency;
account for other apps sharing the key, retries, free refusals, fallback credit, discounts and taxes.
Store only aggregate evidence, never key ids, account ids or customer content. Report missing provider
access or incomplete log retention explicitly. An empty export is not evidence of no spending.

## Reproducible comparison and decision

`scripts/rewrite-evaluate.ts`, corpus/rubric version **2026-11-02.1**, has eight synthetic cases:
short English, warmer tone, shorter text, Croatian, German, Japanese, exactly 1000 characters and
benign security copy. Both models receive the same existing prompt/schema/effort/4096-token limit.
The service tests separately exercise forced refusal/fallback, truncation, malformed/empty/filtered
output, missing usage, provider errors, retry and timeout. Canned responses test behavior, never model ability.

Run the no-network harness (new output file required):

```bash
pnpm -C apps/web exec node scripts/rewrite-tools.mjs evaluate --stub .next/rewrite-stub-evaluation.json
```

Observed fixture run on 2 November 2026: **16 logical calls, 16 HTTP attempts**, each with fixed
120 input/60 output tokens and no caching. Applying the rate table gives **USD 0.01344** for eight
Opus fixtures and **USD 0.00672** for eight Sonnet fixtures, total **USD 0.02016**. These are arithmetic
checks against fabricated usage, not spend, savings, model latency or quality evidence. Both fixtures
return three distinct, valid-length strings; meaning/language/instruction/drop-in quality is **unmeasured**.
Provider charges are unavailable. A daily fixture report may be generated from the saved rows' events.

For an intentional live run, supply an authorized existing key via the process environment or Node's
`--env-file` (never arguments/source control), leave `ANTHROPIC_BASE_URL` unset, and choose a private
new output file:

```bash
pnpm -C apps/web exec node --env-file=/absolute/path/approved.env scripts/rewrite-tools.mjs evaluate --live .next/rewrite-live-evaluation.json
```

This executes at most **16 sequential logical calls**, with unchanged retry and fallback settings.
It stops after an error, incomplete accounting or USD 1 in accumulated observed estimates. This is
not a hard provider-dollar ceiling: a last call, retries or fallback can exceed the visible estimate.
Each call still has the production 45-second deadline. Failed/incomplete runs preserve collected rows.
The explicitly requested local file contains only synthetic example outputs for review and is created
with private permissions; content never enters operational logs. Record actual provider spend separately
when accessible; the harness never fabricates it. No live call is part of automated tests or default commands.

Score each output blind to model on five dimensions, **0 fail / 1 needs editing / 2 usable as-is**:
meaning and original language; requested tone/length; plain-text drop-in replacement without explanation;
three genuinely distinct suggestions; each suggestion within 1000 characters. The harness checks distinct
strings and character lengths only; it leaves semantic dimensions null for human review. Keep refusal,
fallback and malformed-output behavior results separate from semantic pass rates. The original automatic
qualification rule required every ordinary case to score 2 on all dimensions, compatible handling and
improved measured cost per usable call, followed by a repeat bounded run. Publish the sample size,
per-case scores, measured token costs, latency and coverage even when the owner explicitly selects
a model before that threshold is met, as in the decision below.

**Decision:** use Sonnet 5.5 for rewrite suggestions. Seven matched, priced pairs measured a 49.3%
lower token-based estimate for Sonnet; this is a small synthetic sample and not an invoice or quality
parity claim. The provisional blinded assistant screen passed all five dimensions on 2/8 Sonnet
bundles and 3/8 Opus bundles. Both models needed edits in other cases. Independent human review and
provider-charge reconciliation remain open in #277; the former automatic all-cases qualification
threshold was not met. The explicitly selected default is Sonnet while those limits stay visible.

Sonnet supports the existing low effort, JSON schema and default refusal fallback parameters
([current model parameters](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)); all other
request bounds stay unchanged. Haiku 5.5 remains outside this comparison because it has
[no server-side fallback](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5).

To change the selected model, update `REWRITE_MODEL` in `suggest.ts`, update the
HTTP stub's expected model and API docs, and rerun accounting/API/desktop/mobile tests. Keep the
versioned `REWRITE_CANDIDATES` comparison list distinct and independent of the production default. Revert by restoring
`claude-opus-5-5` in those same places. Do not change budgets or retry policy to improve benchmark results.
