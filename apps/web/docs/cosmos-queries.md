# Cosmos query diagnostics

`app/store.ts` keeps complete-list queries complete and exposes exact `count` for totals that
must not load or cap documents. Memory and Cosmos implementations must agree. No default TOP
is permitted for authorization, membership or erasure. Notification selection filters due rows;
lease/access/idempotency checks remain at dispatch. The store's opt-in sampled diagnostics
(`db/diagnostics.ts`) must accumulate every SDK page and never log values, documents, SQL,
continuations or raw diagnostics. See [Cosmos query costs](../../../docs/cosmos-query-costs.md) for
the operation inventory, measured limits, safe preview profiling and the unchanged-frequency
forecast. In-memory tests cannot establish RU savings.

- Sidebar counts use `CommentsStore.countOpen`: one partition-scoped scalar `COUNT(1)` per listed visible project, with workflow, archive and viewer visibility predicates before aggregation. No thread list or candidate cap participates; memory and Cosmos share these semantics. Failures omit the badge.

MCP monitor reads use a separate request-local `AsyncLocalStorage` accumulator. It records numeric
SDK charges and operation counts without enabling diagnostic logs or retaining access decisions.
The two bounded monitor tools (`list_feedback`, `list_feedback_events`) expose those charges in
`x-uier-database-ru` and the existing request event, including rate-limit counter patch/create
attempts. Other tools and streams report no complete billing header; timeout/cancellation omits
it because storage work may still finish later. TTL cleanup, storage, transfer and hosting are
excluded. Concurrent requests cannot share charges.
