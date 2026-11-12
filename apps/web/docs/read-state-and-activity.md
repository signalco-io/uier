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
isolation; `thread-history.spec.ts` covers the app controls, reloads, themes and accessibility, and that toolbar threads show no activity.

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

- The app bulk-read browser test (`activity.spec.ts`) assigns through the assignee menu's checkbox items and Done,
  then checks environment, page and people filters in list/board views, an axe scan of the filtered list and failed-read retry.

- Activity summaries use `CommentsStore.listActivity`, a compact projection over all authorized
  threads, so badge counts do not inherit text-list limits. Unread content is selected before
  applying response limits. Preserve legacy author-only projections and private-thread filtering.

Message reactions are not activity: they never advance the thread's sequence, unread state, history or
notifications ([Message reactions](reactions.md)).

MCP list summaries also expose `replyCount` (all reply items, including deleted placeholders) for
missed-event reconciliation. This count is independent of unread activity and read acknowledgements.

Manual pull request additions/removals record URL-free history entries in the conditional thread write and advance thread activity. Duplicate links and absent removals are no-ops; only the linking triager can remove their manual link.

Connector replies use a separate server-only activity identity per account. A reply through MCP
(or another authenticated connector) is therefore unread for its human owner too, even without
`writtenBy`. Real authorship, permissions, history and notification recipients keep the account id.
All non-reply MCP operations use the human account activity identity: they remain read for that
account and unread for other members, without acknowledging any earlier unseen replies or
other-member activity. Notification and history connection attribution is
unchanged. This also applies to the legacy resolved-status write.
This includes status, assignment, verification, agent attachment/start-work, priority,
mention edits, manual PR links and archive changes. Working-presence leases add no activity.
Imported integration status changes retain the separate connector identity of the connecting
account. Imported replies already have external actor identities. No-op writes, receipt replays
and working-presence leases still add no activity.
Human app/toolbar/extension replies remain own activity and never clear unseen connector activity.
Existing persisted cursors are not rewritten; the distinction starts with new connector writes.
`e2e/activity.api.spec.ts` covers both reply persistence paths, summary/toolbar projections,
acknowledgements, mark unread, replay/no-op behavior and imported status changes.
`mcp.api.spec.ts` covers non-reply tool writes and preservation of unseen activity;
`notifications.api.spec.ts` verifies human, access-token and OAuth verification delivery without
duplicate or self email.


Archiving/restoring records `archived`/`restored` history with the same private-period filtering and
human activity identity as ordinary status changes. It never writes a read receipt. The notification
ledger feeds MCP `feedback.archive_changed` (an `archived` boolean); email delivery excludes these
events. Ordinary unread/workflow totals exclude the archive, with a separate authorized `archived`
count. Restoring reveals the thread's existing unread state plus activity by other people.
