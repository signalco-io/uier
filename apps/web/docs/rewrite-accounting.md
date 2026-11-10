# Rewrite accounting

`src/lib/rewrite/suggest.ts` is the shared showcase/project model boundary, for rewrites and for a page's
suggestions (`src/lib/pageSuggestions/`, the SEO panel's AI search section): `createSuggestionCall` makes the
call, each feature brings its prompt and its output filter, and page suggestions mark their event with
`feature: "page_suggestions"` and share the rewrite limits ([page suggestions](../../../docs/api.md#page-suggestions)). Emit exactly one bounded
`rewrite_usage` event per configured service call via `telemetry.ts`; record usage before output is
refused, truncated or rejected. Keep content, identifiers and raw errors out of logs, including SDK
payload logs. Telemetry must not fail a rewrite. `pricing.ts` owns versioned source/date/USD rates;
`report.ts` aggregates UTC daily exports with explicit retry, fallback and missing-usage coverage.
See [rewrite costs](../../../docs/rewrite-costs.md) for operations, model evidence, limitations and revert.
`rewrite-accounting.api.spec.ts` and `rewriteFixtures.ts` cover accounting without paid calls. A single
ordinary iteration with a null model may use the serving response model; preserve unknown models and
fallback gaps. Evaluation summaries must never turn an unknown charge into zero. Live
comparison requires a separate explicit bounded command; never put it in automated tests. Preserve
budgets, timeouts, output validation and route response shapes when changing instrumentation or models.

Workspace/project rewrite instructions are resolved server-side (`rewrite/settings.ts`; inheritance
is documented in [project settings](project-settings.md#workspace-defaults-and-project-settings)).
They enter the same single configured model call as escaped style guidance, never the system prompt.
The selected text and the reviewer's instruction are escaped the same way (`&`, `<`, `>`), and the system
prompt tells the model to write those characters, not their escaped forms, in its rewrites.
Provider-reported input usage includes that guidance; do not estimate or subtract its tokens separately.
No guidance, mode or setting value enters telemetry. `rewrite-instructions.api.spec.ts` checks the
prompt boundary, full provider input usage and one event per route call; the accounting outcomes
above also run with private style guidance to catch content leaks and preserve failure/fallback costs.
