# Cosmos query costs

Investigation for [#279](https://github.com/signalco-io/uier/issues/279), measured on
2 November 2026 (Europe/Zagreb), using `@azure/cosmos` 4.10.1. The machine-readable
[receipt](evidence/cosmos-queries-2026-11-02.json) contains only operation labels and numeric
measurements. It contains no document, partition value, address, token or SQL parameter value.

## What the evidence supports

The original audit reported about 329,351 RU for `app`, roughly 77% of account RUs, and
about €0.107 in billed account RU charges for 26 October–1 November. That did **not** attribute
cost to individual queries. A read-only Azure Monitor extraction for
26 October 00:00–1 November 23:25 UTC, before these preview load tests, reports:

| App operation | RU | Share of app RU |
| --- | ---: | ---: |
| Point reads | 243,286 | 73.86% |
| Queries | 62,993 | 19.12% |
| Replaces | 15,804 | 4.80% |
| Creates | 6,155 | 1.87% |
| Batch, deletes and TTL deletes | 1,167 | 0.35% |
| Total | 329,406 | 100% |

The all-container extraction totals 429,000 RU (rounded), with `app` at 76.79%.
Azure Monitor totals are approximate; the small difference from the earlier audit is not a
measured saving. The historical metric identifies SDK operation types, **not** application
call sites or routes. There is no evidence that all of the app share is avoidable. In
particular, live membership, project references and user reads already use point reads.

The production probe used an Azure **read-only account key** and invoked no worker or write
API. At 23:45 UTC it cost 158.56 RU including candidate comparisons, fixture selection and
interactive reads. There were no retries or throttles. The worker query component had no
pending notification/sync sources, no due deliveries, and two failed notification ledgers.
Each idle discovery/due/status query cost 2.80–3.19 RU and returned zero to two documents.
The two blocked notification queries cost 6.05 RU before and 6.03 RU with exact counts.
Empty integration counts cost the same as their old capped lists. This is almost no current
idle saving; the purpose of the selected changes is efficient growth and accurate counts.

A representative authorized admin read path, selected in memory without logging its
identifiers, made five point reads (user, workspace, membership, project reference, project)
at **1 RU each**. Membership, project, member and team lists used 2.95, 2.93, 2.96 and 2.80 RU;
feedback and read-cursor lists used 3.84 and 3.34 RU for 14 threads/cursors. Those lists already
pass their known partition. Client-observed latencies include network time and cold metadata;
they are not Vercel route latency measurements. This sample does not establish historical
request frequency or identify which logical read dominated the week's point-read total.

## Operation inventory

`P` means a point read; `Q` means a query. All results are complete unless a bound is stated.
Frequency describes triggers, not a measured production traffic distribution. All writes keep
their existing conditional/transactional semantics and TTLs.

| Operation family and source | Access, scope and cardinality | Frequency and completeness |
| --- | --- | --- |
| Sign-in, session, users (`app/signIn*`, `sessionIdentity`, `users`, `google`, `microsoft`, `passkeys`) | P for hashed sign-in requests, browser/OIDC state, email → user, user, passkey/challenge/reference; Q for a user's passkeys in `user:` | Each proof/session/action; singleton P, complete credential list; proof TTLs unchanged |
| Workspace/context (`app/context`, `workspaces`) | P for workspace and member; global Q by `userId` for memberships and `createdBy` for workspace quota | Signed-in requests/menu/create; all memberships required for access and accurate quota |
| Project lookup/list (`app/projects`, `projectPublicIds`, `clients`) | P public/internal reference → workspace/project and client-name claims; Q projects/clients in workspace | Renders/review requests/mutations; complete lists; client collision existence Q intentionally `limit: 1` |
| Teams/access (`app/access`, `teams`, `accessMutations`, `invitations`) | P workspace revision/member/team/invitation/token/generation; Q workspace members, invitations, active teams (101 detects limit), team/event history with caller bounds | Current authorization and mutation retries; must never truncate an access snapshot; render cache is request-scoped |
| Review reads (`review/*`, `comments/readState`, `app/projectComments`) | P project/member/comment/subscription/preference and individual cursor; Q partition-scoped comments (caller text window), complete activity projection/read cursors, member enrichment | Review/list/write requests; counts and unread selection need full activity/cursor results; content windows retain existing bounds |
| Anonymous comments and counters (`repo/cosmosCommentsStore`) | P comment/image/submission/sequence/counter; partition Q list/listAll (caller TOP), activity (projection, no TOP), sequence MAX fallback | Requests, rate windows, first sequence creation; image metadata/blob relationship and atomic submission batches unchanged |
| Notification discovery (`notifications/delivery`, `preferences`) | Global comments Q pending sources; P project/reference, user, member and current preferences/read cursor; Q subscriptions in project notification partition and complete workspace access | Scheduled turn and mutations; complete fan-out and final authorization checks required |
| Notification delivery/status | Global app Q legacy completed ledgers missing TTL (100/status); active **due** deliveries (no TOP); exact COUNT by blocked status; P/replaces per leased attempt | Scheduled turn; provider/lease/retry rechecks stay authoritative. Manual retry id lookup remains global Q; it does not know the project partition |
| Integration discovery (`integrations/discovery`, `syncSignal`) | Global comments Q, 100 by indexed `syncKey`, durable cursor; P project reference/project, cursor and deterministic ledger identity | Scheduled turn; 30-second discovery allocation, pending flag clears only after fan-out; syncKey includes domain and id |
| Integration backfill/delivery/status (`worker`, `backfill`, `statusSync`) | Global Q backfill connections (100/id), due ledgers (100/nextAttemptAt), accepted status rows (100/id with durable cursor); exact COUNT by blocked status; P project/grant/connection/member/ledger | Independent rotating provider turns, shared job deadline (8 minutes), per-provider time/call budgets and leases; no new delivery cap or cursor |
| Provider settings/OAuth/grants (`integrations/{github,linear,notion,slack,azure-devops}`) | P deterministic connections, installations, grants and state claims; workspace/project-scoped Q reusable grants, destinations, links and status; global Q only for provider maintenance, ownership/disconnect/recovery where scope is not known | Connect/settings/maintenance/recovery, existing explicit safety bounds retained; encrypted secrets and external operations unaffected |
| MCP/OAuth (`mcp/credentials`, `mcp/oauth/*`) | P hashed credentials/access/refresh/code, current grant/user/membership; Q user-partition credentials/grants, workspace/project access lists; global grant scans during project erasure | Every authenticated call rechecks current access; no cross-request positive cache; complete erasure/access lists |
| Cleanup/deletion (`comments/cleanup`, `app/projectDeletion`, MCP removal) | Known-partition Q deletion intents, notification/provider records and workspace references; necessary global Q read receipts, review codes, OAuth/setup/grant records; P current owner/etag before removal | Explicit deletion plus scheduled retries; **complete** deletion passes, pending intents never expire; completed intents retained one day |
| Screenshot maintenance (`repo/cosmosCommentsStore`, `scripts/notifications-worker`) | Global Q legacy inline images (20 per environment); projected orphan metadata (100/SDK continuation), container TTL read, P owner/image and persisted Blob sweep state | Scheduled turn; remaining TTL and conditional image replacement unchanged; Blob sweep already persists progress and backs off an hour |
| Email reports/suppression/status (`email/*`, `status/*`) | P normalized-address hash suppression/receipt and missing comment probe; global Q operation-id ledger matching | Report callbacks/requested email/status polling; report receipts 30 days; status probe does not list documents |

All call sites use the shared store contract. SQL parameter values and partition suffixes must
never become operation labels. Global membership, access erasure and identifier-only recovery
lookups cannot acquire a partition merely by wishing one were known.

An isolated real-Cosmos idle app-worker comparison ran the actual notification/integration
worker functions three times per version, loading the pre-change functions from commit
`b1a89f6a9aa387868bb7645867ca14a228209925`. Each run started with a fresh synthetic namespace,
empty discovery and disabled external adapters. Both versions used **78.24 RU**, 25 queries,
25 SDK pages and two point operations; mean elapsed time was 2,776 → 2,522 ms. Returned rows
were 1 → 13 because twelve empty-list responses became scalar zero counts. The discovery
cursor was persisted in Cosmos and deleted afterwards. Before the change, blocked-status lists
contributed 33.60 RU (43% of this idle turn); the other thirteen queries contributed 36.40 RU,
and cursor read/create contributed 8.24 RU. These app-worker turns exclude comments
queries (measured by the production read-only probe), provider maintenance and the full scheduler's
screenshot/erasure phases; they demonstrate no idle RU regression, not total scheduler savings.

## Equivalent preview datasets and results

The synthetic fixture used only `app-preview`: eight synthetic workspaces, twelve projects,
64 unrelated logical partitions, and two growing histories of 20 then 1,200 records. Rows have
2 KiB synthetic payloads and repeated ids in distinct project partitions. One notification in
twenty is due; the others are in the future. All blocked history is failed/inactive. Both query
variants run three times against each unchanged dataset, with 100 records per SDK page.

| Query and dataset | RU before → after | Mean client ms before → after | Rows before → after | Pages before → after | Queries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Due notifications, 20 active | 4.32 → 3.16 | 192 → 53 | 20 → 1 | 1 → 1 | 1 → 1 |
| Due notifications, 1,200 active | 115.44 → 7.18 | 1,175 → 92 | 1,200 → 60 | 12 → 1 | 1 → 1 |
| Blocked integration count, 20 history | 4.44 → 3.29 | 206 → 95 | 20 → 1 scalar | 1 → 1 | 1 → 1 |
| Blocked integration count, 1,200 history | 98.10 → 3.29 | 1,147 → 131 | 1,000 → 1 scalar | 10 → 1 | 1 → 1 |

The last old result was capped at 1,000 and therefore undercounted. The new scalar correctly
reports **1,200**. Notification blocked counts use the same count operation without the old
integration TOP. There are no retries/throttles in this fixture. The new due query returns the
same eligible rows as filtering the old complete result in memory; the processing boundary
still point-reads and checks due time, active state and lease.

Together those two large-fixture operations use **213.54 → 10.47 RU (95.10% less)**, 22 → 2
SDK pages and the same two queries. This is a per-operation synthetic result, not a production
account saving. Setup, comparisons, boundary tests and exact-identity cleanup together recorded
49,196.45 RU; the final fixture-only count verified zero records remained. Every inserted record
also had a one-hour TTL as a cleanup fallback.

At a page boundary the live preview test deleted a later row and made another future row due.
The complete scan drained twelve pages and returned 1,199 surviving records. The next due turn
returned 61 rows, including the newly due one and excluding the deleted one. The changed
notification query introduces no durable cursor or TOP: subsequent runs start a fresh due
selection, so rows moved behind a prior SDK page cannot be permanently skipped. Existing
per-ledger progress, leases, failure budgets and idempotent operation identities remain intact.
In-memory coverage separately verifies duplicate ids, >1,000 exact counts, a delete between
selection and the leased read, and preserving a future delivery for a later turn. Existing
integration suites cover rotating discovery, provider budgets, leases, retries and time limits.

## Decisions and limits

- **Changed:** filter active notification delivery rows by indexed due time before loading
  documents; use an exact server count for blocked notification/integration totals. No positive
  authorization cache, UI pagination change, blanket TOP or new cursor is introduced.
- **Known partition candidate, left unchanged:** explicitly passing an already-equal partition
  predicate measured 2.94 → 2.95 RU on both fixture sizes. Current interactive callers already
  pass their partition. The cleanup scan omission is a possible future consistency cleanup,
  not a demonstrated saving on this account.
- **Point reads and projections, left unchanged:** existing identity/reference ids already give
  1 RU point reads. Complete membership and authorization remain live. The activity and orphan
  image paths already project small fields. No measured reason to alter their document shapes
  or introduce a cache was found.
- **Indexes, left unchanged:** live `app` has consistent automatic `/*` indexing, excludes only
  `_etag`, has `/pk` partitioning and per-document TTL enabled (`defaultTtl: -1`), and no composite
  indexes. Query metrics show retrieved/index-hit counts matching returned documents for the
  selected list queries; the preview aggregate is served without document retrieval. An extra
  index would add write/storage costs without a demonstrated need. Logical partition diversity
  does not simulate a physically repartitioned account.
- **Legacy images, left unchanged:** the production and preview probes each returned zero legacy
  images at about 2.8 RU per scan. At a five-minute schedule their combined empty-query cost is
  about 11,400 RU/week, around €0.003 at the rate below. No completion marker/frequency change
  is justified; repeated scans preserve the safe path for late legacy data and remaining TTL.
- **Other global scans/cursors, left unchanged:** integration discovery uses domain-plus-id
  `syncKey`. Generated integration ledger ids hash provider/connection/project/thread identity;
  accepted-status cursor assumptions are unchanged. The new store page draining and count work
  with equal ids across partitions and add no `afterId` use. This change does not claim to bound
  the notification worker's total due backlog or redesign existing provider scheduling.
- **Historical attribution limit:** point reads dominate the dated Azure window, but individual
  route frequencies and logical point-read totals were not retained. The bounded probe and
  opt-in telemetry enable repeatable operation attribution; they do not reconstruct missing
  history. No paid Vercel Observability tier is required or assumed.

## Diagnostics and store contract

`AppStore.query` still drains every SDK page unless its caller explicitly supplies an existing
logical limit. Empty pages with continuation are not an end condition. `AppStore.count` accepts
only type, optional partition, equality filters, due time and missing-TTL predicate; it returns
one exact nonnegative integer across the complete match set, never a capped document list.
Cosmos and memory share those semantics. Do not pass a paging bound to `count`.

Set `UIER_COSMOS_DIAGNOSTICS_SAMPLE_RATE` to a fraction from 0 to 1 for a bounded investigation;
default 0 disables logs. Existing console logs are sufficient. One record covers a logical
query across **all** pages, or an app point/batch operation. Comments queries, comment reads and
orphan-metadata pages are also measured; this is not exhaustive instrumentation of Blob or
every comments write. Logs include stable operation shape (type and filter **field names**),
allowlisted container, deployment environment, single/cross-partition scope, accumulated RU,
duration, returned rows, SDK page count, failed/retried attempts and 429 counts. They contain
no SQL, values, documents, identities, raw diagnostics or continuation tokens. The standalone
worker labels its records `scheduled`; request code defaults to `interactive`.

There are at most 120 operation records per process per minute, followed by one cap marker.
Sampling and the cap reduce overhead, not database work. A capped interval is unsuitable for
unbiased traffic extrapolation. Compare equal sampling windows and scale uncapped counts by
the recorded sample rate; group operation counts separately from average RU. Never enable
SDK `debug-unsafe` logging. See the SDK's [FeedResponse contract](https://learn.microsoft.com/en-us/javascript/api/@azure/cosmos/feedresponse?view=azure-node-latest)
and [diagnostic guidance](https://azuresdkdocs.z19.web.core.windows.net/javascript/azure-cosmos/4.5.1/index.html).

## Reproduce safely

Use Node 24, the locked dependencies, and an authenticated Azure CLI principal with scoped Cosmos
data-plane roles. The script uses `AzureCliCredential` and never retrieves account keys. No
container/account is created or modified and no Pulumi command is invoked.

```sh
pnpm install --frozen-lockfile
node apps/web/scripts/cosmos-query-profile.mjs production-read-only <resource-group> <account> > /tmp/cosmos-production.json
node apps/web/scripts/cosmos-query-profile.mjs preview-synthetic <resource-group> <account> > /tmp/cosmos-synthetic.json
node apps/web/scripts/cosmos-query-profile.mjs preview-idle <resource-group> <account> > /tmp/cosmos-idle.json
```

Production mode only reads existing containers. Use Built-in Data Reader on `app`, `comments`
and `comments-preview` for a dedicated diagnostic principal. Preview profiling needs Data
Contributor on `app-preview`; request that temporary grant only when running synthetic profiles. It stops
at 1,000 accumulated RU, 500 response fetches, two minutes, or 20 pages/2,000 rows per operation.
These are diagnostic aborts, not application result caps. Preview mode hardcodes `app-preview`,
prefixes every synthetic partition with its unique run id, and records exact identities before
attempting a write. It stops loading/querying at 80,000 RU, 12,000 response fetches or ten minutes;
each query also has a 50-page/5,000-row guard. Cleanup always runs, even after a budget error,
and deletes only that run's exact identities. Failed cleanup fails the command; the one-hour
TTL remains as fallback. Never change the target to a production container for a load test.
The idle mode bundles the actual old/current workers, scopes every app read/write to a unique
preview namespace and rejects unexpected mutation methods. It uses empty in-memory comment
sources, so no user delivery or external request can occur. It cleans up its exact cursor identities;
those records also have one-hour TTL. The baseline commit must exist in the local Git history.
Do not share raw CLI/SDK exception output to diagnose access problems.

The source/SDK tests run separately and establish correctness, not RU savings:

```sh
pnpm typecheck
pnpm build
PORT=4304 PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test e2e/cosmos-queries.api.spec.ts e2e/notifications.api.spec.ts e2e/integrations.api.spec.ts e2e/integrationSignals.api.spec.ts e2e/blob-screenshots.api.spec.ts --project=API --retries=0
pnpm test
```

Validation on 2 November 2026: `pnpm typecheck`, `pnpm build` and the default `pnpm test`
passed after integrating current main (547 web tests passed, one gated live test skipped;
workspace extension/toolbar checks also passed). The focused affected API run passed 99 tests;
the expanded boundary test passed separately. The three live measurement modes above provide
the Cosmos RU evidence independently of those in-memory checks.

## Cost forecast, with unchanged frequency

The Azure Retail Prices API, retrieved 2 November 2026, lists **€0.2738 per million RU** for
West Europe, product `Azure Cosmos DB serverless`, meter `1M RUs`, effective 1 July 2021.
This is a dated public retail forecast, not the account's discounted invoice, and excludes
storage, tax and other services. Reproduce with the [retail API](https://prices.azure.com/api/retail/prices?currencyCode=EUR&$filter=armRegionName%20eq%20%27westeurope%27%20and%20productName%20eq%20%27Azure%20Cosmos%20DB%20serverless%27)
and compare the [serverless pricing model](https://azure.microsoft.com/en-gb/pricing/details/cosmos-db/serverless/).

If the two large synthetic operations occurred on **every** five-minute turn, their measured
203.07 RU saving × 2,016 turns/week would save 409,389 RU, approximately **€0.112/week**.
Today's idle probe supports only a negligible saving, not that workload forecast. This PR does
not change any polling interval. Apply frequency changes from [#278](https://github.com/signalco-io/uier/issues/278)
separately: total RU = calls × RU/call; do not count the same reduction twice.
