# Cosmos-first query plan and Azure primitive costs

Current recommendation, 11 November 2026. Supersedes the PostgreSQL-first recommendation in
the [alternative backend design](backend-plan.md) and its [alternative delivery sequence](implementation-plan.md).
The [UI/component contracts](components-plan.md) remain applicable; a filtering interface does
not require a particular database. Planning only: no resources or product code changed.

The first backend now has a [source-backed implementation note](../../../apps/web/docs/comment-query.md).
It implements complete bounded candidate evaluation and live keyset paging; native indexed paging,
aggregate fast paths and production latency qualification remain follow-up performance gates.

## Decision

**Implement and benchmark a complete Cosmos-native query path first.** Keep PostgreSQL as a
contingent option if measured query latency or RU cost misses the agreed workload target.
The existing capped list loaders are implementation limits, not proof that Cosmos is inadequate.
The earlier recommendation introduced a second database before testing the optimized existing one.

Keep the versioned typed query AST, field/operator inventory, authorization, shared app/toolbar
behavior, multi-value/nested All/Any/Not rules, arbitrary registered scalar sort rules, dates,
unread, exact query counts, facets and saved views. Replace the backend adapter, not that contract.
Full functionality means applying all requested conditions across the complete authorized scope,
without a hidden recent-result cap. Fast execution for every possible expression at any size is
not established; that remains a measured acceptance requirement.

## What the existing Azure primitives can do

| Primitive | Useful role | Limitation and decision |
| --- | --- | --- |
| Existing Cosmos DB for NoSQL | Parameterized Boolean predicates, array membership, range/text filters, composite-index ordering, aggregates, saved views and session manifests | Primary query engine. Add explicit query methods, normalized fields and measured indexes |
| Cosmos computed properties | Indexed derived scalar values, such as normalized sort ranks | Optional after verifying current account/SDK/Pulumi support; not needed when canonical writes materialize fields atomically |
| Cosmos native full-text indexes | Optional token/word-based search mode | Not a replacement for existing literal substring semantics; do not silently change search behavior |
| Azure Table Storage | Keyed metadata, checkpoints or a known precomputed lookup | Only PartitionKey/RowKey are indexed; arbitrary properties/orderings would need our own secondary index system. Do not use it as the main filter engine |
| Azure Queue Storage | Backfill, cache warming, rebuild and reconciliation jobs | Background message transport, not a query engine. Never wait for a queue to make a canonical privacy or read-state change correct |
| Azure Blob Storage | Optional compressed result-ID chunks or non-authoritative snapshots | Object storage, not an arbitrary filter/sort index. Every retrieval still needs authorization/version validation |
| Vercel instance memory | Small in-flight coalescing or bounded short-lived complete-evaluation cache | Opportunistic only; instances are separate and can disappear. Never an authority for permissions or completeness |

The repository already declares Cosmos and a protected Standard_LRS StorageV2 account with
private screenshot containers. It does **not** declare tables or queues. StorageV2 can support
those services, but using them requires additive resources, separate names/identities/RBAC and
environment isolation. Do not reuse screenshot-specific credentials or cache sensitive query
data in screenshot containers. Source: [storage infra](../../../infra/src/screenshots.ts).

Technical sources: [Table query/index/sort behavior](https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design-for-query),
[Queue purpose](https://learn.microsoft.com/en-us/azure/storage/queues/storage-queues-introduction),
[StorageV2 services](https://learn.microsoft.com/en-us/azure/storage/common/storage-account-overview),
[Cosmos indexing](https://learn.microsoft.com/en-us/cosmos-db/indexing),
[computed properties](https://learn.microsoft.com/en-us/cosmos-db/query/computed-properties),
[native full-text behavior](https://learn.microsoft.com/en-us/cosmos-db/full-text-indexing).

## Concrete backend changes

### 1. Shared compiler and canonical query metadata

Retain `@uier/comments-query`, the field/operator capability registry and one server query
service with project, workspace and server-resolved public scopes. App/review/public adapters
keep their existing identity and origin rules. Scope and visibility are mandatory outer predicates;
user OR/NOT expressions can never widen them. Old URLs and pinned GET clients remain compatible.

Add small, versioned normalized fields on the **canonical comment document**: priority/status
ranks, effective dates and missing-value flags, normalized relationship IDs, reply/attachment
flags, valid title/search metadata and actor-aware activity maxima as needed. Compute them through
the same ETag-protected write as the comment. Do not copy image bytes or audit history.

This avoids a second asynchronously synchronized database and a continuously running projector.
A compact companion row is an alternative only if it is in the same Cosmos container/partition
and transactional batch; it must have an explicit type and no `path`, or legacy list/activity
queries could mistake it for a comment. Prefer canonical fields unless measured document/index
size makes the companion row useful. Backfill legacy data before claiming indexed coverage.

Computed properties could eliminate some stored scalar duplicates, but cannot join viewer
receipts or derive values across items. Verify support instead of making this plan depend on
a preview capability. Ordinary stored fields and explicit update helpers are sufficient.

### 2. Indexed fast path

Extend the repository with query-page/projection/count operations, rather than adding more
arguments to listAll. Push authorized predicates to Cosmos before any limit. Select only IDs,
sort keys and necessary summary metadata; fetch full thread details on open.

Add composite indexes for measured frequent shapes: priority then number/ID, creation, update,
workflow order and completion/archive history, with useful status/environment prefixes. Use
explicit missing-value/rank fields so ordering is stable on legacy records. Do not pre-create
every possible permutation of eight sort fields.

Cosmos requires a matching composite shape for multiple ORDER BY properties. For an indexed
shape, query/order/page directly in Cosmos and return an opaque service cursor. Read all SDK
continuation pages required for a logical page, including empty pages with continuation. Verify
the pinned JavaScript SDK's partition/cross-partition behavior rather than promising a native
cursor contract it does not provide. Source:
[composite ordering rules](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy#composite-indexes).

Literal substring search can use `CONTAINS`, including case-insensitive matching. It can require
a full index scan as distinct values grow. Push selective project/status/environment conditions
first, measure RU and include short/punctuation queries in the benchmark. Do not call it a cheap
index seek or replace it with prefix/word matching. Source:
[CONTAINS](https://learn.microsoft.com/en-us/cosmos-db/query/contains),
[index scan behavior](https://learn.microsoft.com/en-us/cosmos-db/indexing).

### 3. Complete residual path

Viewer-specific unread and some custom ordering combinations need application-side work. For
those valid queries, first obtain a **proven superset** of candidates with Cosmos predicates;
drain every candidate page without the current TOP 200/1,000 window. Fetch compact metadata,
load only relevant viewer receipts, apply remaining predicates and the full comparator on the
server, then return the requested page of summaries.

Pushdown under OR/NOT needs three-valued conservative reasoning. Simply deleting an unread
clause from an AND/OR/NOT tree can remove real matches. Test candidate-superset proofs against
the complete pure evaluator. Deduplicate relationship joins before ordering/counting.

Unread retains `lastOtherSequence > readSequence`, with exact actor identities and backward-moving
Mark as unread receipts. Keep the existing helper as the oracle. Do not create one unread row
per person per thread or make a queue the only path that updates unread state.

For workspace/My work, compare a role-scoped cross-partition compact query against bounded
parallel project queries. Avoid hydrating every project's full comment window. Retain each
project's access/visibility predicate and My work's assigned→mentions→unread precedence.

A complete residual scan can be slower and costlier on large broad queries. Apply explicit
time/memory/RU budgets; exceeding them produces an honest query-too-expensive/retry response,
never a partial list labelled complete. The latency gate determines whether this path is
acceptable for the supported workload; full semantics are not proof of instant performance.

### 4. Results, counts and paging

Use the planned compact summary DTOs, detail-on-open, read-only POST transport, cancellation,
capabilities, exact aggregates and async option endpoints. This work is needed with either engine.
Use native Cosmos COUNT/grouped aggregates when the complete predicate is pushable; otherwise
count the same complete residual evaluation. Fetch aggregates independently of first rows.

Do not impose the PostgreSQL alternative's application-temporal history/commit-clock system as a
prerequisite for normal filtering. Default indexed paging is a live result view with stable unique
tie-breakers; ordinary concurrent changes may move records. Announce new results and deduplicate
IDs rather than pretending that a native continuation is a point-in-time database snapshot.

For a complete residual evaluation, optionally retain its ordered ID list and counts in a
short-lived, viewer-bound result session. Store a manifest/chunks with TTL in Cosmos app data;
use private Blob chunks only if measured size warrants it. Record the evaluation interval,
query/schema, resolved scope/viewer and source/policy/receipt versions. Reuse that accepted order
for later pages without rerunning the sort. It is a materialized evaluation result, not a claim
that a multi-page Cosmos scan observed one atomic database snapshot during concurrent writes.

Cached IDs/counts are not authorization. Recheck current access and canonical visibility/version
rules before serving. Purge/recompute on privacy, deletion, redaction or relevant policy changes;
TTL alone is not a privacy protocol. Do not return cached aggregates when their authorization/
policy generation cannot be validated. Preserve the existing source consistency contract; stricter
cross-session linearizable revocation or strict point-in-time paging is a separate requirement
that must be proved, not invented through a cache. Normal updates need not continually reset a
viewer who is browsing a retained result order.

### 5. Queue and Blob are optional accelerators

Start with no queue-dependent correctness path. If warming/rebuilding a large compact snapshot
is useful, write a same-partition durable intent with the source mutation and dispatch queue work
after commit. Consumers are idempotent/version-aware, retry safely and reconcile missed dispatch.
Read-your-write, private access and current read receipts still come from the canonical path.

Queue operation cost is small, but the worker's compute, observability and failure recovery also
have a cost. A queue does not provide the worker. Use Blob for packed disposable data, not to
build an unmeasured custom search engine as a cheaper-sounding replacement for an indexed DB.

## Cost checked on 11 November 2026

The Azure figures below were retrieved from the public Retail Prices API in EUR for West Europe,
Consumption pricing. They are retail unit prices, not this account's invoice, and exclude tax,
discounts, transfer and other service meters. Price receipts are in
[cost evidence](cost-evidence-2026-11-11.json).

| Item | Verified unit / illustrative cost | What it excludes |
| --- | --- | --- |
| Existing Cosmos serverless | €0.2738 per million RU | Data/index storage, extra writes/backfill, Function compute and egress |
| Example: 100k queries/month averaging 50 RU each | 5m RU → about €1.37 in query RU | An assumed workload, not a forecast or observed query charge |
| Queue Storage v2, Standard_LRS | €0.0036 per 10k operations; 1m operations → €0.36 | GB storage, worker compute; one job usually performs several queue operations |
| Queue data storage | €0.0404/GB-month | Operations and worker compute |
| Azure PostgreSQL Flexible B1MS example | €0.0179/hour → €13.07 for 730 hours of compute | Storage, backups, availability, worker and the fact that this tiny burstable SKU is not SLO-qualified |
| Neon Launch alternative example | $0.106/CU-hour + $0.35/GB-month; 0.25 CU always on for 730h + 1 GB → about $19.70/month | More capacity, transfer, restore/history extras and projector compute; not a recommended provider selection |
| Supabase Pro alternative | Starts at $25/month | Additional capacity/services, projector and any required extras; not a performance guarantee |

The Cosmos-native design adds **no new fixed database subscription**. It is not free: extra
index writes, complete scans, session storage and existing Function execution are metered.
Actual incremental cost needs measured RU/query, request volume, writes and payload sizes.
Table/Queue storage can be inexpensive, but moving query logic there would trade service cost
for index-maintenance engineering and operational complexity.

Price sources: [Azure Retail Prices API](https://prices.azure.com/api/retail/prices),
[Cosmos serverless pricing](https://azure.microsoft.com/en-us/pricing/details/cosmos-db/serverless/),
[Queue pricing](https://azure.microsoft.com/en-us/pricing/details/storage/queues/),
[Neon pricing](https://neon.com/pricing), [Supabase pricing](https://supabase.com/pricing).
Provider discovery did not provision any service. The source price pages/API above,
not directory listings, establish these amounts.

## Revised execution sequence

1. **Baseline first:** measure actual project/workspace sizes, common query shapes, per-query RU,
   transfer and route/browser latency with bounded read-only profiling. Hypothetical 100k/1m
   fixtures remain stress tests, not evidence of current production scale.
2. **Contract and compiler:** shared AST/operators/sorts/capabilities, pure oracle, safe pushdown,
   public/project/workspace authorization and legacy URL compatibility.
3. **Canonical metadata/indexes:** ETag/batch updates, safe versioned legacy backfill, additive
   composite policy via CI, prove index transformation and coverage; no asynchronous source drift.
4. **Query adapter:** indexed path, complete compact residual path, exact counts/facets/options,
   thin summaries/detail, service cursors and optional retained result sessions.
5. **Both UIs:** reuse the existing component plan, including app Combobox/Calendar additions,
   toolbar-native equivalents, advanced groups, sort editor, cancellation and saved views in Cosmos.
6. **Benchmark and optimize:** test full semantics, short/broad text, unread, arbitrary sorts and
   busy projects. Target warm HTTP p95 ≤ 150 ms and visible filter results p95 ≤ 250 ms. Record
   indexed versus residual results separately; no claim that every shape passes before measurement.
7. **Optional existing-storage accelerators:** add queue warming/private Blob chunks only for a
   measured bottleneck, with current canonical authorization and crash-safe invalidation.
8. **Escalate only with evidence:** if an actual required query cohort still fails latency or
   cost gates, compare dedicated query engines, including the retained PostgreSQL alternative.

Keep all required code/CI/authenticated runtime checks from the earlier delivery plan. Activation
needs explicit query capability, index/backfill coverage and local/hosted parity. Rollback restores
legacy simple queries and clearly disables unsupported advanced views; it never approximates
them over a truncated recent list. No provider or infrastructure change is authorized by this
planning document itself.
