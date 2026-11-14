# Optimistic comment updates

`CommentUpdates` is the common update channel for project rows, counters, board columns and the
open thread. React's `useOptimistic` lasts until an action's transition ends. Paged windows and
canonical thread details refresh in separate HTTP requests, so ending that transition does not
mean either projection has received the write. The earlier posted-reply gap had the same cause
(uier #377, commit `1a3b5b6c`); its card-local reply retention remains in place.

`useOptimisticCommentUpdates` adds successful-write retention to the project list, paged detail
and My work board. `useCommentUpdate()(change)` returns a confirmation callback: call `confirm(result)`
only after `result.ok`. Until then, failure keeps the existing transition rollback. Bulk read confirms
only the returned successful IDs; skipped and failed cursors remain available for retry.
An explicit cursor reversal confirms with `{ retain: false }`: it supersedes an earlier retained read
without retaining the reversal until a separate read-receipt version contract exists.

Confirmed fields overlay older snapshots until that projection observes their saved receipt.
Reconciliation is per field, with workflow state and its server-owned timestamps together, and
archive state together. Comment actions return only the saved comment's monotonic activity sequence,
using the mutation result without another database read. A snapshot at or beyond it releases the
overlay, including concurrent edits whose final value differs from the optimistic one. Client
timestamps do not need to equal server timestamps. Newer successful
writes supersede older completions for that field, without dropping unrelated changes. Read
acknowledgements preserve the current activity sequence, so another person's newer activity stays
unread. Mark as unread is the explicit cursor reversal. No extra refresh or polling is added.

Retention is scoped to the project/account/environment/author snapshot (detail also to the thread),
and applies only to rows still supplied by authorized reads. It never adds an absent row or grants
visibility. The detail loader also scopes its stored result, so reusing the component for a different
thread cannot show the previous thread's data.

Adopted operations: manual/automatic/bulk read, workflow status and cancel verification,
assignment, priority, labels, and the open thread's archive/restore choices.
Remaining migrations need separate receipt contracts: mark unread (cursor reversals), follow/unfollow,
replies (including stable saved message IDs,
images and recordings), message edits/deletion, reactions, agent assignment, thread titles, bulk triage
and Archive all. Their existing optimistic behavior stays in place; replies retain the earlier local
protection. Board sort/group/archive-column preferences and other app settings are outside this
comment-update channel.

One existing limitation remains: changing to a server-filtered window that omits a thread while its
status write is still pending can drop that thread's optimistic count. The held-write filter/history
case in `app-performance.spec.ts` reproduces with both the previous transition-only reducer and this
layer. Fixing it needs a paged membership/count contract, rather than reintroducing rows absent from
authorized query results. Successful writes over stale rows are covered here; missing-row membership
is follow-up work.

`e2e/app-performance.spec.ts` delays stale page/detail responses past successful actions, verifies
mark-as-read through its success toast and status through another reviewer's later change, and retains failure rollback
coverage. `optimistic-comments.api.spec.ts` covers cursor freshness, server timestamps, superseding
fields and out-of-order completions. Read failure/retry and automatic acknowledgement coverage remain
in `activity.spec.ts` and `comment-auto-read.spec.ts`.

Successful action adapters now notify the data pager without page revalidation (uier #410).
Confirmed-write retention still bridges the independent page/detail requests. A failed read keeps
both the authorized loaded window and its retained changes until retry succeeds.
