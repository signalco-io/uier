# PostgreSQL alternative for complete, fast comment queries

**Status: contingent alternative, not the current recommendation.** Start with the
[Cosmos-first plan](azure-primitives-plan.md). The schema, SQL/projector, temporal-history and
cross-store fence work below applies only if measured requirements justify adopting PostgreSQL.
The typed query and audience contracts remain useful across adapters.

Proposed architecture, 11 November 2026. Planning only; no database, runtime or infrastructure
change has been made. Read with the [interaction guidelines](README.md),
[component plan](components-plan.md) and [delivery plan](implementation-plan.md).

## Decision

If the Cosmos-first benchmark fails its required latency/cost gates, evaluate a
**PostgreSQL query projection** for comments, participant relationships and read receipts.
Keep Cosmos as the authoritative write/detail store. Keep the Next.js route handlers and existing
authentication. Both app and toolbar call one query service through their respective authenticated
routes. Use a pure shared query contract, not two independent filter implementations.

This is an architectural recommendation based on the required operations and inspected source,
not a measured claim that changing databases will deliver a particular latency. Approve the
implementation against the performance gate below before directing production reads to it.

The complete target includes nested All/Any/Not expressions; typed multi-value and empty-value
operators; literal text search; dates; viewer-relative predicates; ordered multi-key sorting;
complete cursor pages, counts and facets; project and authorized workspace queries; personal and
shared saved views. Delivery slices must converge on that complete contract. Do not release the
advanced controls over today's capped local arrays and describe them as complete.

### Why a separate query path

| Current source | Effect | Planned replacement |
| --- | --- | --- |
| [Cosmos list methods](../../../apps/web/src/lib/repo/cosmosCommentsStore.ts) use TOP, full documents and created-time ordering | Later filters cannot find older matches | Predicates and sort before cursor pagination in `CommentQueryStore` |
| [Review listing](../../../apps/web/src/lib/review/comments.ts) applies visibility after its bounded list | Newer invisible rows can crowd out older visible matches | Mandatory visibility predicate inside every query and aggregate |
| [Toolbar read routes](../../../apps/web/src/lib/review/readRoutes.ts) cap and hydrate full threads; [DTO budgeting](../../../apps/web/src/lib/comments/dto.ts) trims the payload | Cost grows with thread size; response truncation is not a query cursor | Lightweight row DTOs, explicit `nextCursor`, detail on open |
| [App loader](../../../apps/web/src/lib/app/projectComments.ts) builds two 1,000-thread windows and enriches them | Repeated hydration precedes search | SSR first query page, reusable client cache, no full shell refresh on each edit |
| [Read state](../../../apps/web/src/lib/comments/readState.ts) joins all activity and viewer receipts in Node | Unread requires project-wide work | Relational receipt join and compact actor-aware activity columns |
| [Snapshot revision](../../../apps/web/src/lib/app/appCommentsSnapshot.ts) hashes a hydrated snapshot | Idle/query changes reload unrelated data | Small version/generation records and query-aware invalidation |
| [My work](../../../apps/web/src/lib/app/myWork.ts) loads each project's window | Workspace results are capped and fan out | One authorized workspace query, with the existing category precedence |

Infra source declares a serverless, Session-consistent Cosmos account in West Europe, comments
partitioned by `/domain` and app data by `/pk`; it declares no composite/full-text policy.
Functions are configured in `dub1`. These are source facts, not a fresh deployment inspection:
[Cosmos infrastructure](../../../infra/src/index.ts), [Vercel configuration](../../../infra/src/vercel.ts).

### Storage alternatives

| Option | Fit for the requirement | Decision |
| --- | --- | --- |
| Existing documents plus new Cosmos predicates/composites | Can improve fixed project queries. Every multi-property ORDER BY needs a matching composite shape; unread currently lives elsewhere | Useful baseline benchmark, insufficient as the general arbitrary-sort/read-join architecture |
| PostgreSQL query projection | Joins viewer state, supports typed Boolean expressions, indexed substring candidates and arbitrary valid SQL ordering | Contingent query engine; benchmark the optimized existing Cosmos path first |
| Search index alone | Can serve text and facets; personal unread/permissions still require another consistency/join design | No additional search engine in the first implementation |
| Full canonical-store migration | Could eventually remove projection consistency complexity | A separate migration, beyond the filtering feature |

The platform reasons are specific. Cosmos requires matching composite index paths/order for
multi-property ordering; its joins are within an item, not across the current comment and receipt
containers. Cosmos also has native full-text search, but tokenization/stemming is a different
contract from uier's literal substrings. This is not a claim that Cosmos cannot search text.
Sources: [composite index rules](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy#composite-indexes),
[join scope](https://learn.microsoft.com/en-us/cosmos-db/query/join),
[full-text behavior](https://learn.microsoft.com/en-us/cosmos-db/full-text-indexing).

PostgreSQL can combine index scans for AND/OR predicates and execute sorts without an index
for every possible field permutation. An uncommon ordering may still require an explicit sort;
there is no universal constant-time plan for an arbitrary expression.
Sources: [combining indexes](https://www.postgresql.org/docs/current/indexes-bitmap-scans.html),
[indexes and ordering](https://www.postgresql.org/docs/current/indexes-ordering.html).

## Performance contract

These are proposed acceptance targets, **not measurements**. Test from the target EU browser
region, using production-like authorization, network, hydration and concurrency. Report cold
and warm paths independently.

| Measurement | Target |
| --- | --- |
| Input echo / chip interaction | No network wait; p95 next visual response within one 16 ms frame on the reference desktop |
| Warm first-page query HTTP request, including auth and summary assembly | p50 ≤ 75 ms; p95 ≤ 150 ms; p99 ≤ 350 ms |
| Database query stage for the common matrix | p95 ≤ 40 ms; measure pool wait separately |
| Explicit filter/sort change to first painted results | p95 ≤ 250 ms on the reference EU connection |
| Last typed character to first painted results | p95 ≤ 350 ms, including a 100 ms trailing debounce |
| Exact counts/requested facets | p95 ≤ 300 ms; independently fetched, never block first rows |
| Cold first request | p95 ≤ 800 ms; visible stable loading state |
| Projection recovery after a committed mutation | p99 ≤ 1 second in the normal-load fixture; read-your-write receipt fencing is always required |

Initial benchmark cohorts: 1k, 10k and 100k threads in one project; 1m across an authorized
workspace; skewed private/archive/unread distributions; large thread bodies; 50 concurrent active
querying sessions and 5 writes/second. Record actual request rate, hardware, pool size and fixture
distribution. Increase the cohort if read-only production inventory shows a larger expected scale.
This is a sizing assumption, not a statement about today's production population.

Include one/two-character text, punctuation-only queries, no matches, broad negation, large OR
groups, missing dates, all sort directions, unread joins and concurrent writes. A benchmark that
only searches a selective three-letter term is insufficient. Full semantics are retained when
an expression is expensive; tune it or return an explicit query-timeout error, never silently
omit old results, switch to prefix matching or remove a condition.

Run PostgreSQL near the Functions region, using a bounded server-compatible connection pool.
Predictable first-search latency requires warm database capacity; scale-to-zero latency must be
measured separately. Keep existing EU data placement requirements. Hosting vendor, exact capacity
and monthly cost are infrastructure-phase decisions backed by this benchmark, rather than a
provider provisioning request in this plan. Do not add Redis before query/hydration measurements
show a need. See [existing cost/diagnostic evidence](../../cosmos-query-costs.md) for the limits of
the current historical measurements.

## Versioned query contract

Create `packages/comments-query` (`@uier/comments-query`), with pure entries for types, registry,
normalization, validation, evaluation and summaries. No React, DOM, fonts, credential logic or
toolbar bootstrap imports. Keep heavy validation/editor code out of the toolbar's initial path.

The wire document has no UI row IDs and contains no SQL or property paths:

```ts
type CommentQuery = {
  version: 1;
  scope: { kind: 'project'; projectId: string }
       | { kind: 'workspace'; workspaceId: string }
       | { kind: 'public' }; // domain/partitions resolved only by the public route context
  collection: 'ordinary' | 'archived';
  location?: { environmentIds?: string[]; page?: PageExpression };
  search?: { mode: 'literal'; text: string };
  where?: Expression;
  order: Array<{ field: SortField; direction: 'asc' | 'desc' }>;
  timezone: string;
};
type Expression =
  | { all: Expression[] }
  | { any: Expression[] }
  | { not: Expression }
  | { field: FieldId; operator: OperatorId; value?: TypedValue };
```

UI condition IDs live in the editor/controller, with a mapping to validation paths. Me, current
page and relative dates are typed symbolic values; the service resolves them from the current
viewer, approved location and pinned evaluation time. They never accept a client-supplied actor.

Projectless showcase/legacy toolbars use the public scope. Reuse the existing public comment
context's host/domain, identity and public-versus-own-feedback partition resolution; never accept
an arbitrary domain or `project:` partition in the body. Internally use a non-null `scope_key`
for each source partition, with nullable real project/workspace IDs. Public contexts use synthetic
clock/gate groups and audience rules, not invented workspace membership. A public context that
combines own feedback and a shared public partition keeps that authorized partition set explicit.

Start with a 64 KiB request limit, 100 leaf conditions, eight group levels including root, 100
values per set and up to eight **distinct registered scalar** sort keys. These are explicit
validation/resource bounds, not recent-result caps. The everyday editor initially exposes
three levels; offer an expanded advanced mode for deeper valid expressions. No limit may be
silently applied by dropping clauses. Keep the existing 200-character quick search limit for
legacy URLs; the new contract allows up to 1,000 characters/50 whitespace-separated terms.

Normalize and deduplicate sets; canonicalize equivalent AND/OR expressions without moving
conditions across groups; validate operators against field types and current capabilities.
Reject empty child groups/incomplete rules; a missing root predicate means true. An empty
multi-selection removes that rule in the UI. Date intervals are start-inclusive/end-exclusive;
calendar-day boundaries use the selected IANA timezone, including DST. Resolve relative dates
once per query session and reuse that instant on every page/count/facet.

### Complete field and operator inventory

| Data-backed field family | Operators | Query/sort notes |
| --- | --- | --- |
| Workflow status, priority, feedback kind/custom type, verification outcome | is any of / is none of; empty where meaningful | Normalize current status precedence and legacy Normal priority. Scalar rank sorts for status/priority; stable ID for custom types |
| Assignees, mentions, participating authors, working-agent kinds | includes any / all / none; empty / not empty | Relationships, not display-name matches; arrays themselves are not sortable |
| Opened by, project, environment | is any of / is none of; empty / not empty where supported | Me resolves server-side; Author participated preserves legacy `author=` semantics; restricted directories remain restricted |
| Page/path, visible title and visible text | literal contains / does not contain; equals / not equals; starts with / ends with; empty / not empty | Exact page and section have dedicated canonical operators, not substring replacements. Stable title/path scalar sorting |
| Read state, private/public, has screenshot, has replies, has fix link | true / false | Viewer-relative unread; private never enlarges access. Only presence flags for attachments, never private image bytes |
| Created, updated, completed, archived dates | before / after / on / between / relative periods; empty / not empty | Completed/archive controls are conditional on their collection; timestamp sorts and documented fallbacks |
| Comment number and reply count | equals / not equals / less / at most / greater / at least / between; empty where meaningful | Numeric sorting, not lexical comparison of formatted labels |
| Device/browser/viewport and page-check origin metadata already exposed to the viewer | typed equality/set/numeric comparisons | Extended field section. Member-only reproduction fields remain absent for guest capability sets; missing audit data is not a pass |

Only register fields with an authoritative projector and an access rule. There are no invented
cycle/label/due-date fields. Unknown/new fields require a schema version/capability update.
For scalar strings, missing differs from an empty string; `is empty` deliberately includes both
where the registry says so. For sets, none means no intersection, all means every requested ID
is present. Negation includes missing values unless paired with `is not empty`; compile these
semantics explicitly rather than depending on SQL NULL's three-valued logic.

Register sortable scalars separately: priority/status rank, created/updated/completed/archive
time, comment number, title, path, environment key, reply count and project key. Enforce applicable
field/scope combinations. Always append `(scope_key, comment_id)` as a unique, stable tie-breaker.
Use stable documented string collation; never sort by a localized display label without recording
the sort contract. Keep missing values last in both directions. A direction change affects one rule.

## Read-model schema and indexes

| Relation | Contents and key |
| --- | --- |
| `comment_query` | `(scope_key, comment_id)` PK; nullable real project/workspace IDs, source domain, canonical path/origin, environment state, visibility/opener, normalized workflow/priority/type, valid display title, dates/ranks, number, reply/attachment flags, activity maxima, source version and expiry |
| `comment_text` | PK by comment + audience + field; normalized visible message/quote/title/path text; deleted content excluded. GIN trigram index, separate from the narrow row/order table |
| `comment_people` | Comment + relationship kind + stable actor ID for assignee/mention/participant/working-agent owner. Index both actor→comment and comment→actor; distinct rows |
| `query_people` / `query_environments` | Authorized option metadata and searchable display names; source generation. Names are joined at query time so a rename need not rewrite every thread |
| `comment_read` | `(scope_key, reviewer_id, comment_id)` PK; source receipt version, read sequence, expiry. Secondary index by scope/comment for cleanup |
| `query_scope_revision` / `query_gate` | Contiguous applied source versions, current security/purge fences, projection health/coverage and schema version; bounded workspace/viewer lookup |
| `query_epoch` and version history | Workspace publication clock; valid-from/to epochs for row, text, relationship, option and receipt versions; short-lived logical query sessions |

Saved views are canonical **Cosmos app documents**, using the app store's ownership/ETag pattern;
PostgreSQL may project discovery metadata but is not a second authority for them. Their query
documents are covered by existing app backup/restore plus schema-version migration. Session/history
data is disposable and rebuildable; its loss expires cursors rather than losing saved views.

Do not duplicate the whole thread, screenshot bytes, tokens, notification payloads or audit history
into query rows. Summary DTOs can come from the projection after freshness/security checks; full
thread details still come from the authorized canonical path. This avoids 50 extra Cosmos point
reads for every 50-row result page. Preserve existing source-specific DTO redaction rules.

Initial indexes to benchmark, not an exhaustive index for every permutation:

- Partial ordinary/archive B-trees beginning with source scope, followed by the common order and IDs:
  priority→number; creation; update; completion; archive. Add status/environment leading variants
  for measured frequent combinations. Include a workspace-leading equivalent for My work.
- B-trees on visibility/opener and relationship tables; expression/partial indexes for materialized
  legacy timestamp fallbacks and missing-last flags. Check private/public skew in the planner.
- GIN `gin_trgm_ops` on normalized text. B-tree equality/prefix indexes on normalized page, title
  and option names where appropriate. Page-prefix matching preserves canonical separators/slashes.
- A receipt primary key serving the current viewer's join. Do not materialize one unread Boolean
  per member per thread on every reply.

Keep an `EXPLAIN (ANALYZE, BUFFERS)` corpus and refresh statistics after bulk backfills. Measure
index storage and write amplification. Rare valid sort combinations can use a top-N sort after
indexed filtering. An index covering a default order is an optimization, not a list of the only
orders the API accepts.

### Literal search, including short queries

The oracle is [matchesFeedbackSearch](../../../packages/toolbar/src/triage.ts): lowercase literal
substring matching, AND between whitespace-separated terms, deleted messages excluded. Define
one audience-appropriate corpus on both surfaces, including valid titles and visible names.
Preserve escaping of `%`, `_` and backslash when compiling LIKE predicates; never turn user text
into regex/SQL or silently enable stemming. Retain source rules for invalidated/disabled AI titles.

Use trigram indexes to select candidates for longer terms, followed by the exact shared semantics.
PostgreSQL explicitly notes that patterns with no extractable trigrams can degenerate to a full
index scan. Do not pretend trigram indexing makes one-character or punctuation-only input cheap.
Source: [pg_trgm indexing behavior](https://www.postgresql.org/docs/current/pgtrgm.html#PGTRGM-INDEX).

Support short input from the start. Benchmark it on the fully scoped corpus. If it misses the
gate, add a project/audience/field-scoped short-gram posting index for one/two-character and
non-trigram terms, intersect candidates, and verify the full literal predicate. That index is
part of the performance remediation milestone, not a change to prefix-only semantics or a
minimum-three-character restriction. Broad negative/very common short queries can still touch
many candidates; disclose timeout/retry rather than returning a false complete set.

Guest/member corpora must not expose names or reproduction fields absent from the corresponding
DTO. A hidden field must not influence matches, snippets, ordering, facets or timing-dependent
option existence. Prefer separate audience columns/rows and explicit server predicates.

### Unread without project-wide scans

From [activity semantics](../../../apps/web/src/lib/comments/activity.ts), project two distinct
actor maxima: `top_actor`, `top_sequence`, `second_actor_sequence` (default 0). Then:

```text
last_other = top_actor == viewer_actor ? second_actor_sequence : top_sequence
unread = last_other > coalesce(current_viewer_receipt.read_sequence, 0)
```

Use the exact existing actor identity; `connector:<user>` remains distinct from the human.
Compare this optimization against the existing helper for legacy and concurrent cases.
Mark as unread intentionally lowers a read sequence: order receipt updates by a separate
monotonic receipt version, never by max(readSequence). Respect receipt TTL and viewer sign-out.

## Query service and routes

Add a server-only `lib/commentQuery/` service and a `CommentQueryStore` interface with
`queryPage`, `counts`, `facets`, `options`, `getGeneration` and saved-view operations. The SQL
compiler uses constant identifiers/operator handlers and parameterized values. Mandatory scope,
visibility, expiry and audience predicates sit **outside** the user tree, including NOT/OR.
Never accept a database column name, role, viewer ID or private-scope switch from the client.

Proposed routes; existing GET endpoints remain compatible with pinned bundles:

| Route | Purpose |
| --- | --- |
| `POST /api/projects/[projectId]/comments/query` | Cookie-authenticated app page query |
| `POST /api/workspaces/[workspaceId]/comments/query` | Authorized My work/workspace query, no per-project content fan-out |
| `POST /api/review/[projectId]/comments/query` | Review-token/origin-authorized toolbar query; read-only POST |
| `POST /api/comments/query` | Projectless public/showcase query, with server-resolved domain/identity/partition context and public audience capabilities |
| Same scope under `/query/counts`, `/query/facets`, `/query/options` | Independently cancellable aggregates and authorized paged option lookup |
| `GET …/comments/query-capabilities` | Fields/operators, legal sort fields, bounds and supported query/schema version for that audience |
| `GET /api/projects/[projectId]/comments/[id]` | New cookie-authenticated detail projection; retain the existing review detail route |
| App-owned `/api/workspaces/[workspaceId]/comment-views` and `…/[viewId]` | List/create/update/delete saved views with ownership and ETag checks |
| `/api/review/[projectId]/comment-views` and `…/[viewId]` | Member-only toolbar adapter to the same view service; limited to that project's views and current grants |
| App-owned workspace `/comment-query-links` and review-project `/comment-query-links` | Explicit creation of a scoped expiring query reference for a large copied link; member-only writes |

The page service accepts `{ query, sessionId?, page: { size, cursor? }, minimumRevision? }`.
Counts/facets accept `{ query, sessionId, ...requestedFields }`; session-bound options use the
same envelope. Only an explicitly fresh directory search may omit sessionId, and its response
is labelled as current directory data rather than a snapshot facet. Validate every session
against query hash, resolved viewer/audience/scope, expiry and current security epoch. The first
page creates it; subsequent cursors and sessionId must agree. Page size defaults to
50, maximum 100. Response rows contain only preview/title/source/status/people/activity/permission
data necessary for the current renderer; message bodies load on open. Count/facet responses use
the same normalized query and evaluation instant.

```ts
type QueryPage = {
  queryHash: string;
  evaluationTime: string;
  revision: string;               // opaque published source/receipt/settings revision
  session: { id: string; expiresAt: string }; // pins a published logical epoch
  coverage: 'complete';            // complete at that epoch after backfill/fence checks
  rows: CommentSummary[];
  page: { nextCursor?: string; hasMore: boolean };
};
```

`hasMore` comes from an extra authorized matching row, not a separate COUNT. Enforce a response
byte budget while preserving the cursor at the **last emitted row**, so an omitted oversized row
is not skipped. Bound individual summary fields. Never silently trim rows without continuation.

Use signed opaque cursors binding normalized query, resolved scope/viewer/audience, schema,
revision vector, evaluation time, expiry and last emitted sort tuple. Mixed ASC/DESC and missing
values need lexicographic seek predicates with explicit null branches; do not use OFFSET or a
naive row comparison. Reject tampered/mismatched cursors. No raw continuation tokens in logs.

Use a **ten-minute logical query session** for complete paging. At page one, pin a published
workspace epoch, resolved relative dates and viewer receipt state. Retain versioned row, text,
relationship, option-name and receipt data for at least fifteen minutes plus worst-case recovery
lag. Every page/count/facet reads that same logical epoch. Commit the publication clock under a
short workspace row lock held until transaction commit; a bare sequence allocation is not proof
of commit order. This is an application temporal model, not a long-held PostgreSQL MVCC snapshot.

Ordinary replies, sort-field edits and mark-read operations do not expire that session. Show new
activity as a Refresh results indicator; on refresh, start a new epoch. The open thread/badge may
update optimistically, while the result count remains explicitly the session's match count. This
prevents later pages from restarting continuously under five writes/second. Privacy/purge changes
still invalidate affected sessions immediately; do not serve historical redacted data. Expiry
returns `409 query_expired` and starts a new session with the usual focus/draft preservation.

Test both the history storage/write cost and the first-page SLO with these temporal predicates.
Do not remove version retention to make a selective benchmark pass. A seek cursor alone is not
a consistent snapshot under concurrent sort-field changes. Do not hold a database transaction
open between HTTP requests. A request needing rows plus aggregates can use one short
repeatable-read transaction, while all separate requests bind the logical session. Source:
[PostgreSQL snapshot isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

Read-only query POSTs need CORS, existing review authentication, body/rate/complexity limits and
abort support. They must not acquire mutation BotID verification. In
[toolbar apiFetch](../../../packages/toolbar/src/hooks/api.ts), distinguish request intent from
HTTP method, and pass AbortSignal through fetch and extension adapters; retain verification on
real writes. Error states include invalid query (400), current access failure (existing 401/403/404
policy), expired/purged session (409), throttled (429), query timeout and projection-not-ready
(503/retry hint). No automatic fallback to incomplete local filtering for an advanced query.

Saved-view/query-link POSTs are actual writes and keep mutation verification/rate guards. Review
members use their current project token/actor, not a third-party app cookie; guests get the query
controls their public capabilities allow but cannot create persistent private/shared views.
Long query references expire after seven days by default, retain their scope/creator/schema,
and never confer access. Public query POST is a read-only route-specific classification; do not
globally weaken existing non-query POST guards or accept a body-provided source domain.

Set explicit initial execution budgets: a one-second SQL statement timeout, a 1.5-second route
deadline and separate bounded aggregate work. These are failure ceilings, not successful-response
targets. Cancellation should reach the driver where supported; enforce server deadlines even if
the browser disconnects. Do not retry an expensive timeout repeatedly without a new user action.

### Counts, options and board columns

Return exact counts over the full authorized expression, separately from row pages. Status-tab
counts replace the dedicated top-level status shortcut, retaining the rest of the expression;
only expose that shortcut when it can be represented without rewriting a nested user's tree.
Advanced-only expressions show Custom. Count own/other statuses in a single aggregate when possible.

Facet default: frequencies **within current matches**. Simple top-level AND pickers may explicitly
request replacement of their own condition node; do not remove all same-field leaves from an
advanced expression. For advanced alternative-value previews, substitute that exact node and
evaluate the whole tree. Expensive previews are optional/debounced and never hold up the picker.
Count readiness is ready/loading/error, not a synthetic zero. Cache only a generation-bound result.

People/page/environment options are paged and server-searched, with selected IDs resolved
separately even when outside the current option page. Directories and totals obey the same access
rules as rows. Removed/unknown values remain legible; no value silently broadens the query.

Boards query each visible column with a shared base predicate and an explicit status partition,
with independent cursors and exact column counts. Apply the chosen personal order within columns;
fall back to existing shared project column sorts, Done completion history and Archive history
when no personal override exists. Only fetch expanded Archive. Avoid loading all columns' entire
contents to render the first screen. List/Board share one normalized filter expression.

## Projection correctness and freshness

This is the principal additional backend work. Cosmos and PostgreSQL cannot share one atomic
transaction. A synchronous dual write without durable recovery is not sufficient.

1. Add a dedicated source query version and durable query-outbox event in the **same Cosmos
   partition transaction** as every relevant comment mutation. Version each comment monotonically;
   bump a small project query revision atomically. Existing ETags protect concurrency but are opaque
   equality tokens, not sortable version numbers. Benchmark the project revision counter's write
   contention. Outbox metadata contains IDs/versions, not copied private text.
2. Do the equivalent in receipt partitions, with monotonic receipt versions. Include app-setting,
   project/environment/page-policy, identity/name, member and title validity changes. Reuse existing
   workspace `accessRevision` as an input, but audit complete coverage before relying on it for query
   policy. It is not currently a universal query/security revision.
3. After canonical commit, attempt a bounded synchronous projection update before responding to
   the writer. Return an opaque commit receipt even when that fast path fails. The durable worker
   retries idempotently; a successful write is not retried as a new comment because projection lags.
4. Run a continuously available, leased projector consuming dedicated source events/change feeds.
   Do not assume a five-minute cron or an unawaited Function promise meets the freshness target.
   Use an appropriate durable worker host; retain a bounded reconciliation job as recovery.
5. Apply comment, text, relationship and revision changes in one PostgreSQL transaction. Publish
   events in contiguous source order per project/receipt stream: N+1 cannot advance coverage past
   an unprocessed N. The synchronous fast path may publish only the next event; otherwise it stages
   work and returns a pending receipt. Track gaps durably. An ID-only event that fetches a newer
   entity version may supersede that entity's older events, but cannot cover another entity's gap.
   Keep superseded-event proofs and dependencies; a receipt referring to rendered comment activity
   cannot publish before that comment version. Checkpoint only after commit. Versioned tombstones
   prevent late resurrection; bookkeeping writes must not create more content events.
6. The query performs normal authoritative identity/workspace authorization, then a bounded
   workspace/viewer gate lookup in PostgreSQL. It does **not** read every project's Cosmos head.
   The gate includes contiguous projection coverage, current deny/purge fences, source-validated
   grant-map revision, health and the caller's minimum commit receipt. Budget at most eight source
   authorization operations independent of project count; parallelize independent reads. The
   workspace query joins its versioned authorized project map rather than hydrating projects.
7. Serve complete results **as of the published projection epoch** after initial coverage is
   reconciled. This is not a claim that a just-committed source write is already indexed. Report
   projection age/health; honor read-your-write receipts and all security fences before answering.
   A short catch-up wait may fit the deadline; otherwise return projection-not-ready and retain
   only a visibly stale, still-authorized result. Background workers compare source heads and feed
   checkpoints outside the keystroke path. Publication health closes if lag or checkpoint integrity
   exceeds its contract; recovery/backfill must prove coverage before reopening the gate.

The [existing integration outbox](../../../apps/web/src/lib/integrations/syncSignal.ts) deliberately
skips private-only mutations and uier feedback projects. It is not an indexing outbox. The
notification activity sequence also does not cover every title/name/policy change. Add a complete
query signal rather than extending unrelated provider delivery semantics.

### Privacy, redaction and deletion barriers

Stale projections can leak counts, IDs, text matches and snippets even if every opened detail is
reauthorized. Before serving **any** query/aggregate/option response, require current identity,
workspace/project access and the corresponding current query-store deny/purge generation.
Session-consistent Cosmos source reads alone do not prove a fresh barrier across Function instances.

For **every restrictive operation**, first commit a durable deny/pending intent to PostgreSQL's
query gate, then commit the Cosmos mutation plus its source outbox intent ID, reconcile/purge the
projection and its grant map, increment the security epoch, and only then clear that intent. This
includes private flips, hard deletes, removed/redacted text, invalidated titles, restricted source/
page settings and every access-revocation path, not only cross-partition operations. If the gate
cannot be installed, the restrictive canonical mutation must not commit; return a retryable error.
That added dependency is an explicit availability tradeoff of this projection architecture.

Query publication and restrictive-fence installation serialize on the same workspace gate lock.
A query session opened before the fence is invalid after the new security epoch; every response
checks current gate state before return. When clearing a fence, the current restrictive ACL/field
policy is committed in the query store. Intersect it with canonical authorization: an older
Cosmos Session read cannot restore a removed role or private-field permission. This deny authority
does not create positive grants, and is not a TTL-based positive authorization cache.

Carry an intent ID through the canonical batch. On uncertain failure, inspect that exact durable
source event before completing/aborting the fence; never clear it merely because an HTTP request
failed. Crashes may temporarily over-deny. Retain tombstones/intent receipts until reconciliation.
Nonrestrictive writes can remain durably queued while query projection is unavailable, but reads
still require healthy coverage and the writer's receipt. Test all deployed old/new writer versions
before activation; one unfenced legacy mutation path is a launch blocker.

Check projection barriers again before returning when a relevant policy change raced the query.
A barrier mismatch fails closed for rows **and counts/facets/options**. Keep
authoritative thread authorization on detail/mutation paths. Explicitly test this protocol with
the query store unavailable and process crashes between every commit step.

Cosmos latest-version change feed omits deletes and may coalesce updates. All-versions/deletes
mode has separate account/backup/SDK requirements. Choose and verify the mode in the infra spike;
the dedicated versioned outbox/tombstone design must work without assuming that mode is enabled.
Source: [change-feed modes](https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed-modes).
Mirror source TTL as `expires_at` in every query predicate; sweep expired projection rows/receipts
independently. Keep tombstones/checkpoints until the recovery/backfill retention contract permits
deletion, rather than expiring a recovery event before it is acknowledged.

## Caching, realtime and instrumentation

- Canonical client key: deployment/schema + viewer/access generation + resolved scope/location +
  semantic query hash + logical session/evaluation time + order + page cursor. Never reuse account/project data
  as a loading placeholder after identity/access changes.
- Seed the app's initial page into TanStack Query from SSR. Keep route/shell navigation separate
  from query changes. The toolbar uses the same page envelope through its authenticated adapter.
- Cancel obsolete text/option requests; guard late responses by request generation even when
  cancellation cannot reach the network adapter. Do not deduplicate different audiences together.
- Result caching is short-lived and revision-bound. Authorization and current barrier checks
  still run. Use in-flight coalescing only for an identical authorized query; no public CDN cache.
- Existing realtime remains metadata-only. Ordinary hints mark a session as having new results;
  refresh starts a new session while preserving drafts/focus. Receipt hints affect only that
  viewer's unread state; privacy hints purge affected sessions immediately. The new
  query generation removes full-snapshot reloads from the filter/idle path; don't introduce a
  second foreground polling scheduler. A lost socket uses the existing bounded HTTP fallback.
- Record auth, pool wait, SQL, counts, summaries, source-head checks, projection lag and browser
  paint separately. Log shape fingerprints, counts and timings, not text, SQL values, actor IDs,
  raw tokens or private condition payloads. Extend the existing bounded
  [Cosmos diagnostics style](../../../apps/web/src/lib/db/diagnostics.ts).

## Migration and acceptance

Create isolated preview projection data and an idempotent versioned backfill. Start durable
capture before scanning. Apply backfill rows conditionally, replay concurrent events, verify
deletions/expiry, and publish coverage only after per-scope manifests/checkpoints reconcile.
Include legacy and public uier feedback partitions, not just ordinary `project:` partitions.

Shadow the complete semantic evaluator against old/default views and synthetic uncapped oracle
data. Compare ordered IDs, counts, permissions and field presence; sampled content stays private.
Probe 1k/10k/100k and workspace cohorts, broad/short predicates and concurrent updates. Roll out
behind an explicit query capability flag per environment/project. Preserve legacy APIs and pinned
toolbar behavior for their compatibility period. Rollback disables new-query reads and clearly
withholds unsupported advanced views; it does not secretly evaluate them over a truncated legacy list.

Infra, credentials, migrations, worker leases, backups, EU placement and live acceptance are separate
release evidence. Apply protected infra through CI only. The [delivery plan](implementation-plan.md)
lists the exact milestones, tests and go/no-go gates.
