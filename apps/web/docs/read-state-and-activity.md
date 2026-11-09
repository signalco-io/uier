# Read state and activity

## Thread history

`src/lib/comments/history.ts` records a separate `DbComment.history` in the same conditional write
as each change, retaining the newest 200 entries per thread in write order. This is independent of
the unread cursor and `notificationEvents` delivery outbox. Existing threads start recording on
their next change; no historical actions are invented from current state or delivery events.

The shared `review/comments.ts` mutation service covers app, toolbar, MCP and bulk triage: each
added/removed person, each attached/updated/removed agent, status, verification request/confirm/
reject/cancel, priority and public/private changes. Removing an assignee records all their removed
agents separately. The AI title job records its own authorship; first-message edits/deletion record
the old title being cleared. Integration status imports, legacy public status writes, anchor
reattachment and the public-to-account feedback move also record history. Board moves use the
same status writes. No-op changes, failed ETag attempts, receipt replays and agent working leases
add no entries. AI title history does not change unread state, notifications or content revision.

History retains only action metadata, actor/subject references and server time: no old titles,
message text, verification details, page URLs, selectors, connection names/ids or agent sessions/models.
App and review DTOs project descriptions with the current project-member directory, replacing departed
people with Former member and omitting account/actor ids. Guest/public DTOs omit history. Entries
from a private period remain visible only to the thread author and admins after publication; current
thread access is always checked first. Feedback exports and integration packets do not include history.
`e2e/thread-history.api.spec.ts` covers retention, concurrency/retries, workflow, projection and delivery
isolation; `thread-history.spec.ts` covers the app/toolbar controls, reloads, themes and accessibility.

## Read cursors and freshness

- `src/lib/comments/activity.ts` and `readState.ts` own thread activity and reviewer read cursors.
  Read acknowledgements require current project/thread access and acknowledge only a rendered
  sequence. Mark as unread (`markThreadUnread`, `DELETE .../read`, `markCommentUnreadAction`) is the one
  explicit move back: to just before the latest activity by someone else, never for own-only threads. Toolbar and app use the same member cursor; notifications must reauthorize before
  reading it for suppression. Do not equate resolution with read state or expose actor ids in DTOs.
  Bulk acknowledgement uses `comments/bulkRead.ts` and `review/bulkRead.ts`: validate every id/cursor
  before writes, at most 200 threads/48 KiB per request and four concurrent cursor writes. Review
  routes retain verified-write protection; public routes retain BotID. Return only successful activity
  receipts, skip missing/hidden/failed threads without reasons, and reauthorize each project thread.
  App list/board actions snapshot the shown unread threads and send sequential batches, retaining
  failed cursors for toast retry. Neither bulk nor single reads acknowledge newer activity. The app's open
  thread reads itself like the toolbar's open thread (800 ms on screen in a focused window, `useReadWhenShown`).

- `e2e/activity.spec.ts` exercises project/showcase adaptive refresh with the Playwright clock:
  15-second active cadence, 30 after one minute idle, 60 after two, immediate return, held-response
  coalescing, pause/resume, drafts/focus, unread and revoked-access cleanup. Count identity/viewer,
  comments and activity endpoints separately; do not equate cycles with HTTP requests or invoice savings.
  See [refresh contract and measurements](../../../docs/review-workflow.md#polling-request-measurement).

- Activity summaries use `CommentsStore.listActivity`, a compact projection over all authorized
  threads, so badge counts do not inherit text-list limits. Unread content is selected before
  applying response limits. Preserve legacy author-only projections and private-thread filtering.
