# Comment query backend

The version 1 read API supports typed nested All/Any/Not conditions, literal search, ordinary
or archived collections, page/environment locations, relative people and dates, and up to eight
sort rules. The app and toolbar have not switched to it yet. Existing comment APIs are unchanged.

`packages/comments-query` owns parsing, normalization, field/operator definitions, evaluation
and deterministic ordering. It has no server dependencies. The server owns authorization;
a valid query is never evidence that a caller can see a project or field.

## Read endpoints

The following prefixes expose `POST /query`, `POST /query/counts`, `POST /query/options` and
`GET /query/capabilities`:

- `/api/projects/:projectId/comments`: current signed-in workspace and current project access.
- `/api/workspaces/:workspaceId/comments`: visible projects of the current signed-in workspace.
- `/api/review/:projectId/comments`: current review actor, project policy and configured-origin CORS.
- `/api/comments`: existing public-feedback identity and partition policy.

Read-only review POSTs skip BotID write verification. They do not create guests or mutate read
receipts. Saved-view writes retain the existing write verification. Cookie routes reject
cross-site requests. All responses, including errors, are private/no-store or no-store.

Query input is `{ query, page?: { size, cursor }, currentPage?, currentEnvironment? }`. Counts
accept `facets?: FieldId[]` (up to eight enum/set/boolean fields advertised in `facetable`); options accept `field`, `search?`, `offset?`. The query
itself is limited to 64 KiB, 100 conditions, depth eight, 100 values per condition and 1,000
search characters. The envelope allows 96 KiB including the cursor. Unknown fields, operators,
properties and unavailable capabilities fail explicitly. Capabilities return the canonical scope
ID to use, including when a review URL used a public alias.

A minimal project request:

```json
{
  "query": {
    "version": 1,
    "scope": { "kind": "project", "projectId": "abcdefghijkl" },
    "collection": "ordinary",
    "where": { "all": [
      { "field": "status", "operator": "isAnyOf", "value": ["open", "in-progress"] },
      { "field": "assignee", "operator": "includesAny", "value": [{ "relative": "me" }] }
    ] },
    "order": [{ "field": "priority", "direction": "asc" }, { "field": "number", "direction": "desc" }],
    "timezone": "Europe/Zagreb"
  },
  "page": { "size": 50 }
}
```

Rows contain a bounded opener excerpt, valid visible title, workflow, source, dates, activity,
flags and revision. They exclude full threads, screenshots, anchors, reproduction details,
audit history and agent credentials. Open details with `GET /api/projects/:projectId/comments/:id` (app view model),
`GET /api/review/:projectId/comments/:id` (review DTO), or `GET /api/comments/:id` (public DTO).
Each performs a single canonical lookup and fresh visibility checks, independently of list caps.
Counts/facets describe the complete current match, not just the page. Facets reject full-text/string bodies,
values over 2 KiB, more than 1,000 distinct values per field or a payload over 1 MiB. Option values come only
from authorized matching rows; they do not enumerate another project's directory. People use
canonical `user:<id>` values and relative Me resolves on the server. Named author filtering and
opened-by sorting require admin access. Reproduction fields are admin-only. Guest capabilities
omit stable assignee/mention/agent IDs; identified guests can filter their own authorship and unread.

## Cosmos execution and limits

`CommentsStore.queryCandidates` is a complete, partition-scoped source projection, independent
of the legacy recent-comments list cap. Visibility, archive, origin and conservative generated
predicates run before candidate budgets. All continuation pages are drained, even empty pages.
The service re-evaluates the complete expression on every candidate before ordering or paging.
A residual branch inside OR/NOT cannot be removed from a pushed predicate unless the resulting
predicate is a proven superset. User input never becomes SQL syntax.

Canonical writes atomically refresh `queryMetadata.version = 1`. This internal metadata is stripped
from ordinary repository reads and excluded from content revisions, so existing mutation/replay
responses and verification guards retain their behavior. Only the internal candidate API reads it. Legacy documents remain
queryable without a migration or backfill; the evaluator uses canonical values. Metadata guards
must retain legacy records. No PostgreSQL, queue, Table Storage, Blob index or new Cosmos
container is needed. Existing Cosmos indexing covers filter paths; this first backend performs
multi-key ordering in the service and does not add unused composite indexes.

Each source defaults to 100,000 candidates, 32 MiB, 10,000 RU and five seconds; the service also
bounds the whole workspace operation to 100 sources, 100,000 candidates, 32 MiB and five seconds,
and divides the 10,000 RU candidate-query allowance among its sources
with fanout four. Exceeding a budget returns HTTP 422 `query_too_expensive`, never partial rows or
partial counts. Cancellation stops Cosmos iteration. Reads have a durable 240/minute actor limit across scopes and a separate normalized
600/minute network limit for guests/anonymous readers, so guest-token rotation cannot bypass it. The endpoint currently recomputes the matching set for each read;
there is no result cache or production latency claim.

Cursors are HMAC-signed, expire after 15 minutes, and bind the normalized query, authorized
sources, viewer and current-page/environment context. Relative dates keep their first evaluation
time. Sorts put missing values last in either direction, then break ties by scope and comment ID.
Paging is a **live keyset view**, not a historical snapshot: concurrent inserts/moves can change
subsequent pages. Each request reauthorizes scope and private visibility; a cursor grants no access.

## Saved definitions

Workspace and member-only review routes expose `comment-views` (list/create), `comment-views/:id`
(get/patch/delete), `comment-views/:id/duplicate`, `comment-query-links` (create), and
`comment-query-links/:id` (get). Definitions live in the existing app container and are personal
or workspace-shared. Query links expire after seven days. Version tokens protect updates and
removal; a stale edit returns a conflict. Access, schema, capabilities, membership, project lifecycle
and sharing permissions are checked on every operation. Loading a link does not grant project access.
Project deletion/transfer removes its definitions from the old workspace. Executing a loaded query
still goes through the normal query endpoint and its current authorization.

## Verification and next performance gate

The API specs `comment-query-contract`, `comment-query-source`, `comment-query-predicate`,
`comment-query-service`, `comment-query-routes` and `comment-query-views` cover semantics,
continuations, authorization before limits, budgets, compact responses, cursors and saved definitions.

Before enabling the UI, benchmark warm and cold deployed requests with representative project and
workspace sizes, selective and unselective filters, unread, search, custom sorts and counts. Record
HTTP p50/p95/p99, Cosmos RU and transferred bytes. The product targets remain warm HTTP p95
150 ms and visible results p95 250 ms; they are targets, not measured results of this change.
Use those measurements to select native indexed paging/composite indexes, exact aggregate fast paths
and appropriately invalidated caching. The full evaluator remains the semantic oracle and fallback.
See the [Cosmos-first plan](../../../docs/design/filtering/azure-primitives-plan.md) and
[UI component plan](../../../docs/design/filtering/components-plan.md).

Custom status IDs refine a category and do not change query v1's `status` field or archive
collection semantics. Query filters and facets continue to use the five semantic categories;
custom names/descriptions are discoverable through MCP `list_feedback_statuses`. The first
custom-status slice does not add a query field or reinterpret saved definitions.


Custom status writes do not change category filters or paging. The review comment DTO includes `workflowStatusId` and `archiveStatusId`; removed IDs fall back to the effective category default in the toolbar menu.
