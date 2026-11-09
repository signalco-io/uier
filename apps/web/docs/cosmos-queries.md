# Cosmos query diagnostics

`app/store.ts` keeps complete-list queries complete and exposes exact `count` for totals that
must not load or cap documents. Memory and Cosmos implementations must agree. No default TOP
is permitted for authorization, membership or erasure. Notification selection filters due rows;
lease/access/idempotency checks remain at dispatch. The store's opt-in sampled diagnostics
(`db/diagnostics.ts`) must accumulate every SDK page and never log values, documents, SQL,
continuations or raw diagnostics. See [Cosmos query costs](../../../docs/cosmos-query-costs.md) for
the operation inventory, measured limits, safe preview profiling and the unchanged-frequency
forecast. In-memory tests cannot establish RU savings.
