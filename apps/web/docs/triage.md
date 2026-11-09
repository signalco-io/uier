# App triage

`@uier/toolbar/triage` owns the pure priority vocabulary/default and deterministic literal word matcher.
`ProjectComments` searches only the server-authorized snapshot (200-character `q`, debounced
replaceState), alongside local filters. Environment/author still navigate. `loadProjectComments`'s
window callback discloses the 1,000-thread storage cap even if hidden rows shrink the client snapshot.
Never send deleted or ineligible text to client search.

`review/comments.ts` owns priority, assignment and status writes. `bulkTriageSchema.ts` validates one
operation and 1–50 distinct ids/keys; `bulkTriage.ts` runs at most four shared mutations concurrently.
Affected-value guards execute inside every CAS attempt. Status also checks `commentRevision`, a
stable opaque hash covering content and future workflow metadata; only delivery metadata is excluded.
Add verification behavior to the shared status service, preserving this guard and never creating
reviewer confirmation from bulk Done. Receipts retain changed/no-op outcomes; replay reauthorizes
without applying the old desired state. The optional store argument supports isolated failure/race
coverage without replacing process-global stores.

`TriageSelection` snapshots exact visible ids, operation, expected values and keys, clears selection
on scope/view changes, rolls back failures through `CommentUpdates`, retains visible failures and
retries uncertain requests with the same keys. Revalidate once per batch, without router.refresh.
Ordinary public-project enrollment grants no priority or bulk powers; `canTriageProject` is enforced
in services and DTOs. Priority adds activity/integration intent only, with no email event. Read it via
`commentPriority` everywhere. Tests: `triage{,.api}.spec.ts`, MCP, feedback-context and integration
suites. See [review workflow](../../../docs/review-workflow.md#search-priority-and-bulk-triage).
