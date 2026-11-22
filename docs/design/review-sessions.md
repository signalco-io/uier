# Review sessions implementation plan

Design reviewed on 22 November 2026. A reviewer collects comments on uier's servers and chooses
**Send review** when the batch is ready. Each eligible email recipient gets one digest. Slack gets
one channel message, and GitHub gets a parent issue. Resuming the review adds to those same groups.
This document sets the scope for implementation.

## What a reviewer and a team get

1. In the toolbar the reviewer chooses **Start review session**. A session marker appears beside the pill.
2. Each new comment is saved at once and marked **Not sent** for people who can already see that thread.
   A member can continue on another device. A guest continues with the same browser visitor identity.
3. The reviewer opens the session marker, optionally adds a title and a summary, and chooses **Send review**.
4. Sending publishes the batch. Eligible recipients get a digest. With grouping enabled, Slack gets
   a summary with the comments as thread replies, and GitHub gets a sub-issue per comment.
5. Later the reviewer resumes the session and adds comments. Sending again adds them to the same
   Slack thread and the same parent issue, and updates the summary.
6. Closing the tab or leaving the review overnight keeps the pending comments available on return.

## Product decisions

| # | Decision | Outcome of review |
| --- | --- | --- |
| 1 | Visibility in uier | Confirmed with existing thread permissions. People can collaborate on threads they can already see. Lists, counts and summaries must respect the same visibility. |
| 2 | Inactive session | Revised to explicit send. An open review can wait overnight. A timer cannot tell a finished review from an interruption, and an email or Slack notification cannot be recalled. |
| 3 | Grouping | Confirmed. Default to grouped delivery, with an admin switch for future sessions. Existing Slack connections using inbound reply sync keep individual delivery until the admin selects grouping. A resume keeps the session's delivery mode at that destination. |
| 4 | Incoming Slack replies | Confirmed for v1. A reply in a shared Slack thread identifies the review but cannot reliably identify a uier comment. Keep it in Slack. Explain this beside the grouping and reply-sync settings. |
| 5 | Send and discard | Confirmed. Allow the author and current workspace admins with project access. Record who acted. Only the author can resume and add comments. |
| 6 | Activity during collection | Revised to follow the thread. Activity on a held comment stays in uier through Send, including mentions and assignments. Activity on previously sent and standalone threads follows its usual rules, even during a resumed review. |
| 7 | Release order | Confirmed that core and grouping ship together. Include both Slack and GitHub in the first release offered to projects using them. Enable other connected projects when their active destinations can honor the selected delivery mode. |

## Names

"Session" is already used for other things, so the new concept is always **review session**
(`reviewSession` in code, `review-sessions` in routes), never a bare `session`.

| Existing name | What it is | Plan |
| --- | --- | --- |
| `ReviewSession` in [`packages/toolbar/src/review.ts`](../../packages/toolbar/src/review.ts), storage key `uier:review` | Review mode started from a review link, for the tab | Rename the type to `ReviewLink`. The storage key stays. |
| `POST /api/review/<project>/session`, `createReviewSession` | Exchanges a review link's code for a token | The route stays (pinned bundles keep working for a year). Rename the handler to `createReviewToken`. |
| `assigneeAgent.sessionId` | An AI agent's coding session | Unchanged. It is nested, and MCP names it. |
| App, extension, proof-share and proposal sessions | Sign-in and preview state | Unchanged. |

In the interface a sent session is **Review 4** (numbered per project, no `#`, which belongs to
comments). Proposed English copy, to be checked against [`BRAND.md`](../../packages/brand/BRAND.md)
and written in all six languages: Start review session, Add to session, Not sent, Send review,
Resume session, Discard unsent comments.

## What exists today

- **A thread is published the moment it is written.** There is no draft or held state on the server.
  Toolbar drafts live only in the browser.
- **Private threads still record events.** Email and MCP apply recipient and actor visibility
  rules. Integrations wait until the thread becomes shared.
  [Integration signals](../../apps/web/src/lib/integrations/syncSignal.ts)
- **One log feeds email and MCP.** Both read the thread's `notificationEvents`. MCP uses write-time
  discovery and event-time cursors. A review left open overnight needs a creation event dated at Send.
- **Email is grouped per thread and recipient.** Twelve new comments are up to twelve emails per admin.
- **Integrations keep one ledger per thread and connection.** Slack posts one root message per thread;
  GitHub, Linear and Azure DevOps create one issue or work item. Nothing models a parent or a group.
- **Ordinary new-thread integration delivery** waits for the scheduled worker so early edits
  can reach the destination together.

## Data

**The session is a document in the project's partition of the `comments` container**
(`type: 'review-session'`, id `$review-session_<id>`, no `path`). Reads that select threads by
`path` skip it, like receipts and tombstones. Being in the thread's partition lets a session and its
threads change in one transaction when adding a comment. A separate release record publishes a
whole revision in one short transaction.

```ts
type DbReviewSession = {
    id: `$review-session_${string}`; domain: string; type: 'review-session'; projectId: string;
    number?: number;               // "Review 4": per project, set when first sent
    authorId: string;              // user:<id>, or a guest's visitor hash
    authorName?: string;           // guests only, as on threads
    title?: string;                // reviewer text, up to 120 characters
    summary?: string;              // reviewer text, up to 1000 characters
    state: 'open' | 'discarding' | 'submitted';
    revision: number;              // last committed revision, zero before the first send
    draftId?: string;              // fresh on every start or resume
    threadCount: number;
    pendingThreadIds: string[];    // bounded by the session limit
    openedAt: string; lastActivityAt: string; submittedAt?: string;
};
```

A thread records `reviewSession?: { id: string; revision: number }` at creation. The revision is
the session's next send. A release record keyed by project, session and revision contains the
submitted thread IDs, submitter, commit time, submitted title and summary, and durable delivery
work. Its existence makes the listed threads published together. Subsequent edits to draft text
stay in the open revision until its send. `queryMetadata` gets `reviewSessionId`.

Derive `held` from membership in a committed release. Batch-load release records for query candidates
before counting or paging external results. Use the same check for direct access and delivery.
In the app and toolbar, existing comment visibility and unread rules apply in both states.

**One open session per reviewer and project.** A pointer document keyed by the author
(`$review-session-open_<hash>`) is created in the same batch as the session, so two starts converge
on one session.

**Limits.** Count up to 100 comments across all sends of one session. At capacity, offer to
start another review and retain the current draft. Apply existing create rate limits at collection.
The cap matches [GitHub's sub-issue limit](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues).

## Lifecycle

| Step | Write | Notes |
| --- | --- | --- |
| Start | Create the session and its pointer in one batch. | Returns the existing open session if there is one. |
| Add a comment | The existing create batch (receipt, thread, screenshot, recording claim) also appends the thread ID to the session under its etag. Include the session and draft IDs in the receipt fingerprint. | Recover a successful receipt first. A stale tab holding a previous draft ID gets a conflict and retains its comment. |
| Send | In one conditional batch create the release record and submission receipt, assign the review number on first send, advance the session revision, clear the pending IDs and remove the open pointer. | Require at least one pending comment, current authority, the expected revision and an idempotency key. A lost response returns the same receipt on retry. Workers can deliver a committed release in pieces. |
| Resume | Set the session to `open` with a fresh draft ID and restore the pointer atomically. | Only when the reviewer has no other open session. A discarded draft's credentials cannot attach to a later resume of the same revision. |
| Discard | Claim the expected open revision under its etag, record the actor and pending IDs, and delete those threads and attachments through the existing cleanup path. Retain the pointer until cleanup completes. | Confirm the unsent thread count and that their replies are included. Retry interrupted cleanup. Remove a never-sent session or restore the previous submitted revision. |

One release record keeps a 100-comment send inside the Cosmos batch limits. A series of transactions
that clear a flag on individual threads would expose a partial review after a crash. Include the
release revision in app and toolbar freshness checks so the badge updates while each thread keeps
its original activity sequence, read cursor and `updatedAt`. [Cosmos transactional batch limits](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch#limitations)

## What waits and what goes out

| Channel | While the session is open | When it is sent | When it is sent again after a resume |
| --- | --- | --- | --- |
| uier (app, toolbar, live refresh, unread) | Comments appear at once, marked Not sent. | The mark goes away. | The same for the added comments. |
| Email | Hold all notifications about each unsent thread, including its replies and mentions. | One digest per eligible recipient for this revision. | One digest for eligible additions. |
| MCP events, MCP tools, REST API | Exclude held threads from reads, counts, writes and events. | One `feedback.created` per eligible comment, with its session ID and revision. | The same for the added comments. |
| Connected services | Defer delivery of each held thread, including its files and discussion. | Create the group and deliver the current shared comments according to the connection settings. | Add to the same group and update its published summary. |
| AI thread titles | Defer automatic title generation for held threads. | Use the existing project setting. | Apply it to new additions. |

Apply the hold inside the common mutation and notification paths. A reply, edit mention or status
change on a held thread still records in-app activity. At Send, publish the current thread and its
eligible discussion as one creation. Ordinary post-send activity follows existing delivery rules.
Serialize a held-thread mutation with Send under the draft's etag in the project partition.
If Send wins the race, retry the mutation with published-thread delivery semantics.
Check the release in integration discovery, backfill, inbound sync and before each external call.
Use the same eligibility for all automatic AI title entry points, including list-triggered work.
See the [comment mutations](../../apps/web/src/lib/review/comments.ts),
[notification event writer](../../apps/web/src/lib/notifications/events.ts),
[integration signal](../../apps/web/src/lib/integrations/syncSignal.ts) and
[source eligibility](../../apps/web/src/lib/integrations/source.ts).

## Review API

All under `/api/review/<project>`, with the review API's CORS, actor and BotID rules.

| Route | What |
| --- | --- |
| `POST /review-sessions` | Start, or return the caller's open session. |
| `GET /review-sessions`, `GET /review-sessions/<id>` | Own sessions, or visible groups for members, paged. Granted project access and visible threads determine group metadata and counts. Only the owner and authorized admins can inspect draft session text or empty sessions. |
| `PATCH /review-sessions/<id>` | The author edits the open revision's title and summary. |
| `POST /review-sessions/<id>/submit` | Send. Accepts the draft ID, expected revision, an idempotency key and the author's optional title and summary. |
| `POST /review-sessions/<id>/resume` | Reopen a sent session. |
| `DELETE /review-sessions/<id>/held` | Discard unsent comments. |
| `POST /comments` | Session additions supply `reviewSessionId`, the draft ID and an idempotency key. The session must be open, in this project and the caller's. Ordinary creates keep their existing contract. |

Require the current draft ID for every mutation of an open review, including discard and edits
to its title or summary. Recheck authorization even when returning a previously committed receipt.
The toolbar's first request returns the caller's open session, so no extra request is needed on load.
Thread DTOs gain an optional `reviewSession: { id, number?, held }`. Anyone who can write comments can start a
session, guests included where the project allows guests. Every new route is added to the
[extension contract](../../packages/toolbar/src/extensionContract.ts) allowlist, which only grows.
uier's own feedback projects and file (proof) threads do not get sessions in this plan.

## Toolbar

- **Start.** In Options, and as a second action in the new-comment form, which starts a session with
  that comment.
- **While open.** A session marker beside the pill shows the number of unsent comments. It sits
  outside the pill, like the point-mode instruction and Resume draft, so the pill's width never
  changes. The form's main button reads Add to session. Pins of unsent comments carry a small mark
  with a Not sent tooltip.
- **Session popover.** The unsent comments (select one to go to its pin), Title, Summary, Send
  review, and Discard unsent comments behind a confirmation.
- **After sending.** The marker goes away. A thread of a sent session shows Review 4 in its header;
  its author sees Resume session there.
- **State.** The server is the source of truth. The open session comes with the first request and is
  kept in React Query next to the comment lists. Drafts stay as they are: a draft joins the session
  when it is posted.
- **Rules that apply.** Shadow root styles only, `toolbarSurface` for the popover, `IconTooltip` for
  icon buttons, strings in all six catalogs, no selectors on English text, and the review bundle's
  size budget.

## App

- A thread's row and card show Not sent while held. After the first send, Review 4 filters to the session.
- The filter bar gets a Review session chip and Group by gets Review session beside labels. A group's
  header gives the reviewer, the number of comments, the state and the sent date, with Send now for
  the author and admins.
- Links from email and connected services open the project's comments filtered to the session.
- The `reviewSessionId` field is added to the [query registry](../../packages/comments-query/src/index.ts),
  the candidate projection, the server mapping, the in-memory store and
  [`projectCommentPages.ts`](../../apps/web/src/lib/app/projectCommentPages.ts), which orders groups
  before paging.

## Email

A session-level delivery ledger keyed by session, revision and recipient sits beside the
thread ledgers. Two rapid sends have distinct receipts even if the second arrives while the first
email is in flight. Use the existing transport's uncertain-send recovery.
[Notification delivery](../../apps/web/src/lib/notifications/delivery.ts)

- **Recipients** are the ones a new comment has today: workspace admins and the project's creator
  with project access, plus people mentioned in the session's comments. Never the author.
- **Before each delivery attempt**, recheck current access, privacy, project mute, thread follow
  preference and the read cursor for each eligible creation or mention. Retain the original activity
  sequence for that check. Count only eligible comments, and suppress an empty digest.
- **Content.** Subject "Acme: Ana sent a review with 12 comments", or "Ana added 3 comments to
  Review 4" after a resume. Up to ten lines, one per comment (number, type, page), then "and N more".
  The title and summary require both the project's email excerpts setting and visibility of the
  entire submitted revision. Excerpts require that setting and eligibility of their thread. One
  action opens the session in the app. Email stays in English.
- **No duplicates.** Only the session digest consumes the release and eligible held mentions.
  Subsequent ordinary events can queue a thread digest while a session email is still pending.
- Nothing is sent from the toolbar or a detached promise. The scheduled worker sends it.

## MCP and REST

Additive only, as the event catalog requires.

- `feedback.created` and feedback packets gain an optional `reviewSession: { id, number, revision }`.
- `list_feedback` and REST `GET /feedback` accept `reviewSessionId`.
- Merge committed release records into MCP poll, stream, webhook discovery, replay and delivery
  lookup. Use the commit timestamp and a stable creation event ID per thread across all transports.
  A delayed worker must still find the release within the feed's existing replay contract. Keep
  creation ordered before later activity. Direct-ID reads, media, writes, bulk operations and
  already-issued cursors must obey the same publication check as lists.
- A `review_session.submitted` event and a `list_review_sessions` tool come later. With them the
  uier-monitor skill can treat a sent session as one batch to triage and group fixes by it.

## Connected services

### Shared layer

- **A group ledger** per connection and session (`<provider>-session-sync`) uses the same lease,
  attempt, checkpoint and authority code as a thread ledger. It has its own document type because
  the worker's due queries and the status poll assume a ledger's source is a thread. Its state holds
  the parent's ids and hashes, never text.
- **Discovery** consumes committed release records. For each destination, only previously released
  threads currently eligible for that destination contribute to a parent, count, page list or progress
  line. Omit the group when none qualify. Use a neutral heading and omit free-text title and summary
  when any submitted thread covered by that text is private, deleted or otherwise hidden from that audience.
  Recompute the published view on privacy changes and deletion. An explicit backfill uses the same checks.
- **Adapters** opt in with `supportsSessionGroups` and `deliverSession(context)`. A thread's
  delivery context gains `session: { id, number, parent }`, where `parent` is the group ledger's state.
- **Children tell the parent.** When a child's delivery is accepted, or a child is cleaned up, the
  group ledger is queued again so counts and progress in the parent stay current.
- **Settings.** `connection.config.groupSessions` with a Group review sessions switch on each
  provider's page, a `review-sessions` feature in [`catalog.ts`](../../apps/web/src/lib/integrations/catalog.ts)
  and the catalog parity test. Pin grouped or individual delivery at the first eligible send for
  that session, connection and destination. A later settings change affects new sessions. When an
  admin explicitly chooses individual delivery, comments still wait for Send. For Slack connections
  with inbound reply sync already enabled at rollout, preserve it with individual delivery until
  the admin chooses grouped threads. Explain this choice in the connection settings.
- **Delivery right after sending.** Persist the release and its pending work together. The
  after-response hook can begin delivery within its budget. The worker recovers from a crash
  immediately after commit and checkpoints each parent and child independently.
- **Unchanged rules.** Persist before send, never resend an uncertain create, authority checked at
  every external call, cleanup without a feedback packet, per-provider budgets.

### Slack

- **Root.** One message per session: "Review 4 by Ana in Acme", linked to the session, the
  reviewer's summary as plain text, and one line of details (comments by type, pages, environment,
  "3 of 12 done"). `chat.update` keeps it current without a notification.
- **Comments.** Each thread's existing card is posted as a reply in the session's Slack thread
  (`thread_ts` is the root's `ts`, `reply_broadcast` false), in comment-number order. Until the root
  exists a child returns `waiting` with `session_root_pending`. Screenshots and recordings follow
  their card in the same thread when file delivery is enabled.
- **Later activity.** With outbound reply sync enabled, uier replies go into the same thread with the comment number in the
  attribution ("Ana via uier on #7"). Optional status and reply-count summaries name the comment too.
- **Replies from Slack** stay in the group thread (decision 4). Exclude grouped roots and cards
  from both the Events API's inbound lookup and the reply poll. Store each child's card timestamp
  separately from the root timestamp so editing or deleting a card affects only that child.
  [Slack thread index](../../apps/web/src/lib/integrations/slack/threads.ts) and
  [Slack thread replies](https://docs.slack.dev/reference/methods/chat.postMessage/)
- **Recovery.** An uncertain root post uses the existing adopt-or-attest action, extended to group
  ledgers; children wait meanwhile. A deleted root marks the group missing, as for a thread today.
- **Cutoff.** Apply the channel activation cutoff per revision at its commit time. After a
  destination change, older revisions require explicit backfill. A resume can send its new comments
  to a new parent at the new destination. Its summary and counts cover only eligible revisions there.
- **Pace.** Use the adapter's channel pacing, file budgets and rate-limit handling. Resume at the
  last confirmed step when the worker runs out of time.

### GitHub

- **Parent.** One issue per session with the title or "Review 4 by Ana: 12 comments", the summary,
  a link to the session and its own marker.
- **Children.** Each thread's issue is created as today. The group ledger links it with
  `POST /repos/{owner}/{repo}/issues/{parent}/sub_issues` and `sub_issue_id` (the issue's numeric
  `id`, already in the ledger). It fits the existing REST client. Replies, status sync and reply
  sync on the child issues work as today.
- **State.** The parent closes when every eligible published child at that destination is done and
  reopens when an eligible open child joins or reopens.
  Closing the parent in GitHub changes nothing in uier, and its comments are not imported.
- **Permission and recovery.** GitHub documents Issues write for installation tokens, which uier
  already requests. Verify a real parent and sub-issue on a test installation before release.
  After an ambiguous link response read back the relationship. Preserve a different existing
  parent. Show the eligible child link in the parent body and record the reason if the relationship
  cannot be added. Rate limits and revoked access follow normal retry and authority handling.
  [GitHub add sub-issue](https://docs.github.com/en/rest/issues/sub-issues#add-sub-issue)
  and [installation token permissions](../../apps/web/src/lib/integrations/github/client.ts)
- **Pace.** Count parent creation, child creation, relationship writes and summary edits against
  the existing content-write budget. Checkpoint confirmed IDs so a resume creates only new children.

### Linear, Azure DevOps and Notion

- **Linear.** A parent issue per session (client-reserved id, as today). The group ledger sets
  `parentId` on each child with `issueUpdate`. The parent uses the mapped open and done states by the same rule as GitHub.
- **Azure DevOps.** A parent work item of the configured type. The group ledger adds a
  `System.LinkTypes.Hierarchy-Forward` relation per child on the parent. Some processes show
  same-type parent links oddly on backlogs, so a separate work item type for sessions may be needed.
- **Notion.** No parent page in this plan. An optional mapped Review session property (text or
  select) holds "Review 4 · Ana" on each page, so the database can be grouped by it. Sub-items need a
  relation mapping the adapter does not have yet.

## Edge cases

- **A held thread is deleted.** Remove its ID from the pending list in the same guarded operation
  as deletion. Release its attachments through normal cleanup. A concurrent Send that commits first
  takes the published-thread cleanup path.
- **A sent thread is deleted or made private.** The existing cleanup removes its copy; the parent's
  counts update. A group with no comments left is cleaned up.
- **The author loses access while a session is open.** It stays held. Check current project access
  and write authority for every send, resume and discard, including on conflict retries. An
  authorized workspace admin can inspect the pending review and explicitly send or discard it.
- **Project deletion and transfer.** Delete session documents, release records, pointers and the
  session sequence on project deletion. Apply the existing transfer rules to project-owned content.
  Revoke old destination authority and recheck project access before serving or delivering a
  transferred review. Group ledgers follow the existing connection lifecycle.
  [Project deletion](../../apps/web/src/lib/app/projectDeletion.ts)
- **Destination changes.** Retire the old route with its children. At the new destination, deliver
  only revisions sent after activation or older feedback selected by explicit backfill.
- **Two fast comments.** Both replace the session document, so the second create retries on the etag
  conflict, within the existing retry bound.

## Not in this plan

Sessions shared by several reviewers, moving an existing comment into a session, hiding unsent
comments from teammates, sessions for file proofs and for uier's own feedback projects, and an AI
summary when the reviewer writes none.

## Order of work

1. **Core.** Session document, atomic release record, review API, worker recovery, session email,
   and MCP and REST publication and visibility checks.
2. **Toolbar and app.** Session marker, popover, Not sent marks, resume; chip, filter and grouping.
3. **Slack grouping.** Group ledger, discovery, `deliverSession`, threaded cards, delivery right after
   sending, and inbound reply handling.
4. **GitHub** parent issues and sub-issues.
5. **Linear and Azure DevOps** parents, and Notion's property.
6. **Follow-ups.** Slack replies routed by comment number, the `review_session.submitted` event and
   monitor grouping, and an AI summary.

The first release includes steps 1–4. Projects using another connected service follow when step 5
supports their selected delivery mode. Expose availability consistently in both the toolbar and
API. If a connection becomes active during an open review, retain its pending delivery until its
selected mode is available. For Notion, grouping requires a mapped Review session property.

## Validation

- `reviewSessions.api.spec.ts`: leave an open review overnight, return from another device as
  the author, race start/add/send/discard/resume, retry a lost response across revisions, and
  recover interrupted discard. Exercise revoked membership, admin actions and guest visitor isolation.
- Send 100 threads together, interrupt processing immediately before and after the commit, and
  read through concurrent clients. Every external reader sees the old or new committed revision.
  On retry there is one release receipt, one group per grouped destination and one child per thread.
  Enforce the cap across revisions and preserve a draft for comment 101.
- `integrationSignals.api.spec.ts`: a held write queues no external work. Committing the release
  queues its eligible children. Race a reply with Send and verify delivery on the correct side.
- `notifications.api.spec.ts`: a held reply, mention and assignment produce no outbound mail.
  Previously sent threads still notify. Check one eligible digest per revision, rapid successive
  sends, per-recipient counts and text, read cursors, unfollow, mute and revoked access.
- Exercise MCP and REST lists, direct IDs, media, writes, filters and counts against mixed held,
  private and published threads. Poll, stream and webhook see one logical creation per eligible
  thread at publication, including after a long-open session and a worker restart.
- `integrations.api.spec.ts`: group ledger discovery, parent ensured from a child, child-to-parent
  queueing, cleanup of an empty group.
- Slack and GitHub stubs cover an uncertain root, a second send after a settings change, missed
  Slack events plus reply polling, sub-issue link recovery, and privacy changes affecting a single
  child in a group. Verify mixed and all-private sessions cannot expose hidden content or counts.
- Hosted acceptance uses a test Slack channel and GitHub installation. Add two comments, pause,
  send, resume and send a third. Verify silence before each send, one Slack root with three cards
  and one GitHub parent with three actual sub-issues. A body link alone does not satisfy this case.
- `review-sessions.spec.ts` on Desktop Chrome and Mobile Chrome for the toolbar, plus the app's chip,
  filter and grouping, with accessibility checks. No new smoke tags.

## Documentation

New area notes `apps/web/docs/review-sessions.md` and `packages/toolbar/docs/review-sessions.md`,
each with a line in its index. Update [review workflow](../review-workflow.md), [the API reference](../api.md),
[connected services](../integrations.md) and each provider's plan, [review notifications](../review-notifications.md),
[MCP](../mcp.md) and the `apps/web` notes for integrations, notifications and the MCP connector.
Public integration pages claim grouping only after each provider's hosted acceptance.
