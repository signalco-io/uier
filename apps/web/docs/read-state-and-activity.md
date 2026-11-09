# Read state and activity

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
