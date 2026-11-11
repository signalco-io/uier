# Filtering and ordering implementation plan

**Status: this is the PostgreSQL alternative's execution sequence.** The current recommendation
and active sequence are in the [Cosmos-first Azure plan](azure-primitives-plan.md#revised-execution-sequence).
The shared UI/contract and verification work still applies; do not provision PostgreSQL or build
its worker/history/fence layer before the Cosmos-native benchmark establishes a need.

Executor-ready plan, 11 November 2026. This request produces planning documents only.
No product code, database, provider, infrastructure or runtime configuration was changed.

## Outcome and decisions

Ship the same complete query language in the app comments list, board, My work and toolbar
inbox. Keep each surface's default location, native toolkit and existing permissions. The
[design guidelines](README.md) define the visible behavior; the
[backend plan](backend-plan.md) and [component plan](components-plan.md) specify the implementation.

This alternative uses a PostgreSQL query projection beside Cosmos, with a shared pure contract,
storage-side filtering/order, cursor pages, independently loaded counts/facets, compact rows and
detail on open. Full functionality includes typed operators, multi-values, nested All/Any/Not,
date/empty/relationship predicates, literal substring search, ordered sort rules and saved views.
The complete field inventory is in the backend plan. No AI query interpretation, new labels/cycles
or manual card ordering is required to achieve this contract.

Near-instant response is an acceptance requirement. Warm query API p95 ≤ 150 ms and browser
filter-to-result p95 ≤ 250 ms are proposed targets, not current evidence. Typing includes a
100 ms debounce and targets p95 ≤ 350 ms from the last character. Complete paging uses a short
logical snapshot; unrestricted ongoing writes do not continually invalidate the next page.

The projection adds real work and operational cost: a warm relational query store, continuously
available projector, version history, migration/backfill, privacy barriers and monitoring. In
particular, a restrictive privacy/access change cannot commit until its durable query-store deny
fence exists. Test and explicitly accept that availability tradeoff before activation. Provisioning
and protected infra changes belong to later execution through CI; this plan provisions nothing.

## Milestones and dependencies

| Milestone | Work and deliverable | Depends on | Exit evidence |
| --- | --- | --- | --- |
| M0: contract and architecture proof | Lock field/operator/sort matrix and audience rules; baseline existing requests; prototype SQL/history/unread, bounded authorization and deny-fence protocol on isolated fixtures | Existing research | Recorded benchmark and crash/security proof; accepted capacity/cost envelope; no unsupported query family hidden |
| M1: pure query package | Types, canonical AST, validation/limits, reducers, normalization/hash, legacy URL migration, semantic summaries and evaluator/comparator oracle | M0 contract | Deterministic cross-adapter vectors, nested/negation/null/date cases, tree size/depth errors and legacy compatibility |
| M2: complete source change capture | Dedicated versioned outbox/receipts, tombstones, every writer path, query gate intents, current access projection and repair logic | M0 privacy proof; M1 IDs | Source+event atomicity; no skipped private/public-feedback/title/read/expiry paths; crash-between-steps tests |
| M3: PostgreSQL projection and query kernel | Versioned rows/text/relationships/receipts, indexes, worker, contiguous watermarks, workspace epoch/history, SQL compiler and session cursors | M1; M2 source contract | Real database parity; contiguous coverage; correct snapshots under ongoing writes; initial SLO matrix |
| M4: routes, summaries and transport | Authenticated app/review/workspace query endpoints, capabilities/options/counts/facets, canonical detail loader, read-only POST and cancellation adapters | M3 | API authorization/redaction/cursor/byte-budget tests; no BotID round trip on search; no full-thread/list hydration |
| M5: app and toolbar controls | Controllers, query bars, chips, common/async/location/date value editors, advanced tree, sort editor/reorder and result states | M1; M4 transport; UI composition can start earlier | Both surfaces use one query representation, full keyboard/touch behavior, six-language toolbar and scoped reset/back behavior |
| M6: saved views and cross-surface links | Canonical Cosmos view documents, owner/sharing/ETag, personal override, update/duplicate/delete, query references and copy links | M4; M5 | Private/shared access and conflict tests, old links preserved, unavailable fields never silently dropped |
| M7: full verification and performance | Full matrix at representative scale, short-text index if needed, rendering/bundle measurement, security/chaos/recovery and existing required checks | M2–M6 | All functional, freshness, authorization and latency gates; exact head and artifact receipts |
| M8: staged activation | CI infra/migrations/worker, safe backfill, shadow comparison, preview acceptance, scoped enablement, production verification and rollback receipt | M7; operational runbooks | Verified deployed code/config/schema, reconciled coverage, authenticated app/toolbar acceptance and observed SLOs |

M1 and reusable UI compositions can run in parallel after the contract is fixed. SQL/index work
and source-capture work can also run in parallel after the event/fence protocol is fixed. Routes
must not claim completeness before source coverage is reconciled. Small PRs may deliver dark
components, but partially implemented advanced queries are not a complete feature release.

## Backend work breakdown

### M0: decisions and measurements before infrastructure rollout

- Capture a source/request baseline for current project list, unread, board and My work. Inventory
  project sizes, thread sizes, role distributions and query frequency using bounded read-only
  diagnostics. Existing historical RU/local timing notes are context, not current route latency.
- Execute representative SQL shapes on disposable PostgreSQL fixtures: multi-key mixed directions,
  broad OR/NOT, sparse unread, missing dates, literal one/two-character and punctuation terms,
  count/facet queries and temporal-history predicates. Record plans, warm/cold latency and pool wait.
- Prove query-gate serialization and all restrictive writer paths across separate source sessions.
  Session-consistent Cosmos reads are not themselves a fresh deny barrier. Compare the proposed
  projection's explicit availability cost with the larger alternative of a future canonical-store
  migration; do not accidentally implement that migration as part of a query optimization.
- Fix an O(1)-in-project-count authorization/gate lookup contract. Initial budget: at most eight
  authoritative source operations per workspace query plus the query-store transaction, independent
  of how many project IDs are in scope. Reject a design that still reads every project/receipt head
  before searching.
- Select capacity/hosting only after proving EU placement, pg_trgm/required extensions, connection
  pooling, backup/restore, worker lifecycle, version-history storage and measured monthly forecast.
  Provider selection and spend are not inferred from a skill's generic provider defaults.

### M1–M3: data/query foundation

Proposed code map, with final names set by the implementing PR:

| Area | Proposed files/modules | Existing seam |
| --- | --- | --- |
| Pure contract | `packages/comments-query/src/{contract,registry,normalize,validate,reduce,summary,legacy,evaluate}.ts` | Today query/search/status definitions are split across app and toolbar |
| Service boundary | `apps/web/src/lib/commentQuery/{service,authorization,capabilities,errors}.ts` | Review actor/project helpers and app context |
| Query compiler/store | `commentQuery/postgres/{store,compiler,predicates,ordering,cursors,sessions}.ts` | Separate interface beside existing CommentsStore; no explosion of positional list arguments |
| Schema/migrations | `commentQuery/postgres/migrations/` plus an explicit CI migration runner | New schema; runtime does not auto-run DDL at module import |
| Source capture | `commentQuery/source/{commentEvents,receiptEvents,policyEvents,intents}.ts` | Comments repository writes, AppStore transactions and access mutation helper |
| Projection worker | `commentQuery/projector/{apply,leases,watermarks,reconcile,backfill}.ts` and a dedicated worker entry | New complete query signal, not external-integration syncPending |
| DTO split | `commentQuery/{summaryDto,detailDto}.ts` | Existing project comment/review DTO redaction and permission helpers |
| Saved views | `commentQuery/views/{model,store,permissions,links}.ts` | Cosmos app document/store and ETag conventions |

Keep database driver initialization lazy and server-only; missing preview config must not fail
the build. Use exact dependency versions at implementation time. The query runtime, projector and
migration runner use separate least-privilege roles. Schema changes are expand/backfill/activate/
contract; do not drop source data or old APIs as part of initial activation.

The event census must explicitly cover creation, edits, replies, deleted messages/placeholders,
full deletion, screenshot presence/redaction, status, verification, archive/restore, priority,
assignment and agents, manual/AI title validity, read/unread receipts, member/name changes,
project/workspace access, environment/page-state settings, transfer/deletion and source TTL.
Record every path and test its capture; repository hooks alone are insufficient if a writer
still bypasses them. Public showcase/legacy partitions need a query-scope mapping too.

Use one event identity/version per source commit. Same-partition source changes and outbox are
atomic. Receipt streams have their own monotonic version, even when readSequence moves backward.
Publish only contiguous stream coverage; never advance a watermark by max(version) when earlier
events remain missing. Serialize workspace publication epochs at commit, and retain all indexed
versions needed by active sessions. Privacy purge invalidates affected sessions/history.

Restrictive writes first create a durable PostgreSQL deny intent, then commit the Cosmos event,
then reconcile/purge and clear that exact intent. Checkpoints and recovery prove the outcome of
uncertain commits. A failed caller response is not proof that the source mutation failed.
The worker must remain available continuously; a five-minute scheduled task is only recovery,
not the mechanism that satisfies a one-second normal freshness target.

### M4: API integration and legacy compatibility

- Both cookie-authenticated app and token/origin-authenticated review routes call the same service.
  Projectless public toolbars use a separate read-only public query route with the existing
  server-resolved host/identity/partition rules; they cannot supply arbitrary source domains.
  Scope/role/viewer restrictions wrap the user AST and apply equally to rows, count, facet and option
  endpoints. Unknown or forbidden field/operator combinations fail explicitly.
- Default 50, maximum 100 compact summaries per page; fetch detail only when opened. Split list-row
  and thread-detail types at render boundaries instead of making every consumer assume a complete
  thread lives in the list cache. Server actions continue to authorize canonical writes.
- Preserve legacy GET shapes, existing revision endpoints until consumers migrate, current default
  status/priority/order, `author=` participation behavior, Archive isolation, page identity, pinned
  bundles and public visitor DTO limits. New capability negotiation prevents an older bundle from
  receiving an incompatible query envelope.
- Classify query POST as read-only in toolbar transport, retaining existing authentication, CORS,
  rate/body bounds and mutation BotID protection. Thread AbortSignal through normal fetch. For
  extension message bridges, use request IDs plus a cancel message/worker AbortController; do not
  attempt to structured-clone AbortSignal. Older adapters may only support result-discard guards.
- Preserve the last emitted row in byte-budget cursors; no hidden result truncation. Bind count/
  facet/option requests to the proper logical session or explicitly document a fresh option lookup.
  Make empty, unauthorized, timeout, not-ready, stale and expired-session outcomes distinguishable.
- Provide member-only review-token adapters for saved views and large query-link creation. These
  are real writes and retain mutation verification; they cannot depend on cross-site app cookies.
  Guests can filter their authorized data but cannot create persistent member views.

## Frontend work breakdown

### M5: reusable behavior with native rendering

Implement the complete [component inventory](components-plan.md#components-to-create-or-evolve).
App additions from official shadcn: Combobox and Calendar. Existing Popover/Sheet/Dialog, Field,
InputGroup, Select, Checkbox, ToggleGroup, Badge, Avatar and feedback components supply the rest.
Date Picker is a composition; the recursive filter builder and sort-rule editor are custom domain
components. Command, a new data table, Drawer and a new generic menu library are unnecessary.

Use separate app/toolbar controllers over the pure reducer/contract. Every shortcut updates the
same active query. Advanced/sort drafts stay isolated until Apply. Default compact nesting is
three levels; expanded mode supports the server's eight-level bound. Include NOT visibly rather
than hiding it in operator rewriting. Async values keep stable IDs and selections across pages.

App search updates only query data and its URL, without full shell refresh. The toolbar keeps
query state in memory and portals into InkScope/shadow root. Neither writes filter text to the
reviewed website's URL or storage. Location remains visible; enabling Unread cannot silently
widen page/status. Preserve legacy board column defaults separately from a personal sort override.

First-page rows, exact counts, options and thread details have separate query keys/readiness.
Cancel/discard obsolete work; clear caches and sensitive drafts on account/access changes.
Stale same-scope rows must be visibly labelled with their previous query/session, never presented
as matches for a new predicate. Session refresh preserves the authorized open thread/composer.
Ordinary external updates advertise fresher results; privacy changes purge immediately.

Implement keyboard reordering before optional drag. Date ranges/timezones, remote options and
grouping need inline validation. Provide no-match recovery with scoped Clear filters, not a
single reset that also changes sorting/location. Complete six-language toolbar strings and
44 px touch targets. Add windowing only with measured long-list/option rendering evidence;
all loaded/unloaded rows must remain keyboard-reachable.

### M6: saved views

Use canonical Cosmos app documents with a versioned query, owner, sharing, scope, name and ETag.
Default to personal. A modified shared view is a personal override until explicitly saved by an
authorized editor. Support duplicate, rename, update, reset and delete with ownership checks and
conflict handling. Sort changes never silently overwrite the existing shared project board sorts.

Small shareable queries can remain in a versioned uier URL. Larger queries use an explicit scoped
query reference created by Copy view link, with expiry and authorization on open. That action
does not grant project access. Me/Unread remain relative to the opening viewer. Reject unavailable
conditions instead of broadening a shared view. Preserve private/shared view permissions even if
PostgreSQL discovery metadata is missing or rebuilt.

## Verification and completion gates

### Correctness and security

- Real PostgreSQL tests compare the compiler and ordering to a seeded pure oracle for nested
  All/Any/Not, null/empty rules, relationship any/all/none, status precedence, legacy assignment,
  literal punctuation/short terms, title validity and timezone/DST boundaries.
- Cover older matches beyond 200/1,000, invisible rows before visible rows, enormous threads,
  all Archive transitions, numeric comment numbers, mixed directions/nulls and stable ID ties.
- Verify own-author private visibility and public-app-path protection; restricted author/
  reproduction fields; directory/count/facet leakage; all OR/NOT escape attempts; capabilities
  changing after a view is saved; cross-project and cross-account cache isolation.
- Kill/restart the worker between intent/source/projector/checkpoint steps. Test duplicate,
  reordered and missing events, ID-only fetch supersession, readSequence moving backward,
  deletes/TTL, source Session reads from another instance, projection outage and barrier repair.
- Page through a busy project to the end while five writes/second and mark-read operations run.
  Ordinary activity must not starve later pages. Counts/facets share that session; privacy purge
  cancels it safely. Test expired/tampered/cross-viewer cursors and failed summary byte budgets.
- Exercise app and embedded/extension toolbar end to end: identical authorized query, chips and
  drafts, URL Back/Forward, touch/mobile/tablet, keyboard-only, screen reader names, focus, light/
  dark app themes, ink toolbar, host modal, blocked storage, six languages and slow/failed requests.

### Performance evidence

Measure the [backend target matrix](backend-plan.md#performance-contract), separately for auth,
source/gate checks, pool wait, SQL, counts, projection age, transfer, summary rendering and detail
open. Include p50/p95/p99, cold starts, concurrency and index/version-history write cost. Use
synthetic data in isolated test stores; never load-test or mutate production for this gate.
Inspect both app initial bundles and toolbar pinned-bundle growth, long tasks and input focus.

No Redis, broad authorization cache, full-project prefetch or silent query simplification may be
used to disguise a missed SLO. An optional short-gram index is required if exact short text misses
the matrix; preserve semantics and remeasure. If the full contract misses the target, record the
failing shapes and resolve storage/index/capacity or product tradeoffs before general activation.

For each code PR, follow repository checks: focused affected API/desktop tests, mobile/tablet
where relevant, then `pnpm typecheck`, `pnpm build`, `pnpm test` before opening/pushing. Direct
browser tests use an up-to-date production build. Database integration tests must use isolated
test configuration and fail closed on production credentials. Full regression is reserved for
the broad final integration gate when focused coverage is insufficient.

## Activation and rollback sequence

1. Merge compatible contract/capture/writer code with query UI/read capability disabled. Deploy
   all server/worker writer versions before relying on query gates; pinned clients still reach
   migrated server mutations. Confirm no bypass path remains.
2. CI applies additive infra/schema and scoped identities. Preview/production use isolated stores
   and credentials; no production key/secret in previews. Record worker health, EU region, backups,
   roles, pool/capacity limits and migration version. Never run local `pulumi up`.
3. Start durable capture, backfill conditionally, replay concurrent changes, reconcile tombstones/
   expiry/relationships and close watermark gaps. Verify per-scope coverage manifests and policy
   generations before opening any query gate. A small random sample alone is not coverage proof.
4. Shadow real authorized default queries and an uncapped fixture oracle. Validate IDs/order/counts
   and audience fields. Capture no raw private text or tokens in comparison logs.
5. Enable preview projects; complete authenticated app, embedded toolbar and extension acceptance.
   Then enable a bounded production cohort and observe latency, freshness, errors, fences and costs.
   Expand only when the complete matrix holds; record the exact deployed source/schema/capability.
6. Roll back by disabling the new query capability, preserving canonical data, outbox and saved
   views. Existing simple clients retain their legacy path; advanced views show unavailable rather
   than being approximated over capped arrays. Disable fencing only after all new-query reads are
   disabled, and retain reconciliation until its recovery contract is satisfied.

Completion means source/contract, local tests, CI, deployed schema/worker/config, reconciled
coverage, authenticated behavior on both surfaces and measured latency/freshness all have their
own evidence. A green build or a fast synthetic SQL query alone does not complete the feature.
