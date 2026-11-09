# Rewrite accounting

`src/lib/rewrite/suggest.ts` is the shared showcase/project model boundary. Emit exactly one bounded
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
