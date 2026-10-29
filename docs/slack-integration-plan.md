# Slack notifications: implementation plan

Status: adapter and project settings implemented. Provider registration and hosted acceptance remain manual release gates. This document retains the original design and proposed phases; [the implemented contract](integrations.md), [setup](integration-setup.md) and [operations](integration-operations.md) describe the current code and limits.

This adapter depends on the shared integration layer in [the Notion plan, section 2.1](notion-integration-plan.md#21-expansion-to-other-services). It can ship independently of Notion's later phases. [GitHub](github-integration-plan.md) and [Linear](linear-integration-plan.md) are issue integrations; Slack is a notification destination.

## 1. Goal and scope

A workspace admin connects a project to one Slack channel. New non-private uier threads produce a short notification with a link back to uier. The notification is kept current, and selected later changes can produce a bounded summary in its Slack thread. uier stays the source of truth; conversations in Slack do not change uier feedback.

Throughout this plan, “non-private” describes thread visibility inside uier; it does not mean the reviewed project or site is publicly accessible. The public showcase project remains excluded.

Phase 1 sends new-thread notifications and updates their summaries. Phase 2 adds optional reply/status summaries and member-only external links. Phase 3 adds a deliberately requested, bounded historical send. Private uier threads, including private app feedback, are never exported. A private Slack channel does not permit private uier feedback to be exported.

Non-goals: Slack commands, interactive resolve/assign buttons, receiving Slack replies, Events API subscriptions, two-way sync, channel-wide digests, DMs, Slack Connect channels, org-wide Enterprise installations, GovSlack, screenshots/files, public image URLs, reading channel history, and a guarantee that every intermediate change produces a notification. No delivery happens in a request or detached promise.

Customer rollout has a distribution gate: Slack's official policy identifies the Marketplace as the channel for commercially distributing Slack API apps, including templated customer-created apps. An unlisted development installation is not treated as customer rollout approval. The owner must confirm uier's distribution eligibility and complete the applicable listing/review before enabling customer connections. [Slack distribution clarification](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/).

## 2. How it works

The shared mutation signal increments `syncVersion` once, regardless of the number of providers. Shared discovery queues a `slack-sync` ledger for the project's Slack connection alongside its Notion/GitHub/Linear ledgers, then clears `syncPending` only after every target is durable.

The scheduled integrations worker leases a due Slack ledger, checks the current binding and connecting admin, rejects private content, and calls `projectFeedbackExport` under that admin's member actor. A pure Slack projection produces a small summary. The runner persists each planned attempt, sends through the bot-token Web API, and records the resulting channel/message timestamp. Later runs update only messages owned by this adapter.

```
uier mutation -> shared signal -> shared discovery -> slack-sync ledger
                                           | other providers queue independently
Slack turn -> lease -> authorize -> authorized FeedbackContext
           -> persist plan -> post/update/delete -> persist result
           -> allowlisted Slack permalink for signed-in uier members
```

Email remains in `src/lib/notifications/`; Slack does not inherit email's per-recipient unread suppression. The selected channel is the destination, not a collection of uier users. No uier member-to-Slack-user mapping is needed.

## 3. Slack facts the design depends on

- OAuth v2 uses `https://slack.com/oauth/v2/authorize` and `oauth.v2.access`; bot scopes use `scope`, user scopes use `user_scope`. The code expires after ten minutes, and the returned bot installation includes app, team and bot identity. uier requests no user token. [OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/), [token exchange](https://docs.slack.dev/reference/methods/oauth.v2.access/).
- Without rotation, access tokens do not expire. With rotation, access tokens expire after twelve hours and refresh returns a replacement refresh token. Enabling rotation cannot be undone. `apps.uninstall` affects the installation; it is not a project-level disconnect. [Token rotation](https://docs.slack.dev/authentication/using-token-rotation/).
- `chat.postMessage` supports bot `chat:write`, channel ids and `thread_ts`; replies need not broadcast to the channel. It accepts blocks and a top-level text fallback; unfurl controls are explicit. Its reference mentions `client_msg_id` in duplicate-related errors but does not establish a durable exactly-once contract for this design. [Posting messages](https://docs.slack.dev/reference/methods/chat.postMessage/).
- `chat.update` addresses an existing message by channel and `ts`; the bot can update its own messages. Removing previous blocks requires an explicit empty `blocks` array. [Updating messages](https://docs.slack.dev/reference/methods/chat.update/).
- `chat.delete` with a bot token can delete only messages posted by that bot. It does not authorize deleting human replies. [Deleting messages](https://docs.slack.dev/reference/methods/chat.delete/).
- `conversations.list` is cursor-paginated and supports `public_channel,private_channel`, archived-channel filtering and scope-dependent results. `channels:read` and `groups:read` provide the relevant channel metadata. [Channel listing](https://docs.slack.dev/reference/methods/conversations.list/), [channel inspection](https://docs.slack.dev/reference/methods/conversations.info/).
- `chat.getPermalink` resolves a known channel/message timestamp to its Slack URL. A returned link grants no additional Slack access. [Message permalinks](https://docs.slack.dev/reference/methods/chat.getPermalink/).
- Web API limits are per method and workspace. HTTP 429 carries `Retry-After`; posting generally permits one message per second per channel, with a separate workspace limit. uier must not depend on bursts. [Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/).
- Slack uses `&`, `<`, `>` for special parsing. Escape those characters in literal strings, avoid interpreting feedback as `mrkdwn`, and disable automatic mention expansion. [Text formatting](https://docs.slack.dev/messaging/formatting-message-text/).

No history-based reconciliation is assumed. In particular, the history/replies permissions, token-type restrictions and distribution-dependent limits are not added merely to resolve an uncertain write. A future design using them needs its own scope and privacy review. [History method](https://docs.slack.dev/reference/methods/conversations.history/), [replies method](https://docs.slack.dev/reference/methods/conversations.replies/).

## 4. Data model

Use the shared connection and sync envelopes. Registry id is `slack`; project bindings use `project.integrations.slack = { connectionId, since }`. Settings writes merge only this entry. One channel per project initially; different providers coexist.

| Document | Partition and identity | Slack-specific fields |
| --- | --- | --- |
| `slack-installation-owner` | `slack-installation:<hash(appId:teamId)>`, `owner` | global installation claim: uier workspace/grant ids, active credential generation, reservation/operation lease, state and timestamps; no token or feedback |
| `slack-grant` | `workspace:<workspaceId>`, `slack_grant_<hash(appId:teamId)>` | app/team/bot ids, sanitized team name, encrypted bot access/refresh tokens, expiry, generation, refresh lease, granted scopes, installation status |
| `slack-connection` | `workspace:<workspaceId>`, `slack_<projectId>` | common envelope, `grantId`, channel id/name, destination generation, notification preferences, backfill cursor, last channel check |
| `slack-oauth-state` | `user:<userId>`, hash of provider/user/workspace/project | hashed random state, provider, workspace/project, creation time; 600-second TTL; single use |
| `slack-sync` | `slack:<projectId>`, `slack_<hash(connectionId:projectId:threadId)>` | common envelope, Slack message records and notification baselines below; no feedback bodies |

A grant represents the Slack installation; several project/channel bindings within one uier workspace may reference it. This prevents copying a rotating token pair into independent per-project refresh loops. Reinstall/refresh updates the grant under an etag and generation guard. Phase 1 supports one uier workspace per Slack installation. Enforce this with the global owner record below, not a workspace-local lookup. Cross-uier-workspace sharing remains unsupported; Slack token reuse/reinstallation behavior is a live launch gate.

The global owner is obtained by conditional create after the OAuth response has established the app/team identity. Its canonical key is independent of the uier workspace. A conflict for another workspace rejects the connection and retains no returned credentials; never uninstall or revoke an installation to roll back that rejected attempt. A same-workspace reconnect takes the owner operation lease and updates the one referenced grant under the expected owner/grant generation. Worker refresh also takes this global operation lease and checks owner workspace, grant id and generation before decryption and before saving the replacement pair. There is only one retained refresh loop for the installation.

Reserve with an operation nonce, then write the workspace grant, then finalize the owner as active. Retries of the same setup operation resume these writes idempotently. A stale reservation may be removed only by a nonce/etag-checked rollback after confirming it has no committed grant; a grant already written is finalized or disabled and wiped before releasing the reservation. Active ownership never expires through a short TTL. Disconnect can wipe the last unused grant while preserving the owner claim in a disconnected state. A fresh OAuth result cannot silently transfer ownership. Explicit transfer requires authorized admins of the old and new uier workspaces, disables and drains old binding/refresh leases, wipes the old credentials, performs fresh authorization, and commits the new owner/grant generation conditionally. All affected bindings require explicit re-enablement. An inaccessible/deleted old workspace requires a separately authorized operator recovery, not automatic takeover.

The app/team identity is known only after code exchange on a first install; a local ownership rejection cannot undo any effect of that external exchange. Reconnects for a known installation hold the global operation lease across exchange, with a bounded setup deadline. Concurrent first installs and rejected cross-workspace reinstalls must be tested against Slack for effects on the existing pair; if they can invalidate it, keep customer rollout gated until the flow prevents that collision or provides verified reconnect recovery. Do not claim the conditional owner record makes the external OAuth exchange atomic.

The Slack ledger extends the shared envelope with `destination: { generation, since, teamId, channelId }`, `root?: { ts, permalink?, payloadHash }`, `notifications: { operationId, ts, payloadHash }[]`, `lastNotifiedStatus?`, `notifiedReplyIds: string[]`, `baselineOnly?`, `suppression?: { reason, at, generation }`, `resume?: { requestedBy, requestedAt, generation, completedAt? }`, `cleanupPending?` and `deletion?`. Slack timestamps remain strings, never floating-point numbers. Store ids, hashes and cursors; do not persist exported feedback or channel history in the ledger.

Each attempt records `operationId`, `through`, destination generation, step (`post_root`, `update_root`, `post_summary`, `delete_message`), plan hash, first-send time and the exact target `ts` when known. Notification baselines advance only after every required write for that projection has a definitive result. `requestedVersion` still merges with `max`, independent of another provider's progress.

Changing channels starts a new destination generation with its own `since` cutoff, set when the admin confirms the switch. Preserve old message ids as retired cleanup records; do not accidentally update an old channel using the new destination. For the new generation, every pre-cutoff or undated thread starts from a silent baseline even if its next edit/reply arrives later. Only post-cutoff new threads, explicit historical sends or explicit per-thread resumes can create roots there. No automatic historical repost on a channel switch.

## 5. Connect and disconnect

Proposed routes are `apps/web/app/(rest)/(app)/app/slack/{connect,callback}/route.ts`, with links declared in `src/knownPages.ts`. Use the shared connection service and the existing app session; the callback is a thin handler around `integrations/slack/oauth.ts`.

Connect requires current workspace admin membership, a project in that workspace, a project other than `PUBLIC_PROJECT_ID` and configured production credentials. Reject cross-site OAuth starts; use an ordinary anchor rather than a prefetched `next/link`. Mint random state, store only its hash with provider/user/workspace/project binding, and redirect with `Cache-Control: no-store` and a fixed registered callback URI. The URL contains no identifying state payload.

Callback requires the same signed-in user, consumes matching Slack state once even on denial, rechecks membership/project ownership, exchanges the code server-side and validates the expected app id, team id, bot token type and granted scopes. Denial or failure does not replace an existing working grant. A session failure starts again at settings; OAuth code/state never travels through the sign-in page.

Reject org-wide installations and unsupported workspaces with clear copy. Reserve/verify the global installation owner, idempotently upsert its workspace-scoped grant, create an off-by-default project connection, then let the admin choose a channel. A different Slack team clears the destination and requires explicit confirmation before enabling. Choosing a destination makes no test post unless the admin separately invokes the test action.

Default to token rotation enabled on the production Slack app after the refresh tests pass. Persist the documented `expires_in` and rotating pair. Refresh shortly before expiry under the global installation operation lease and grant etag; compare owner/grant generation, atomically write both new ciphertexts, and recheck the lease on save. A crash after rotation but before persistence may require reconnect; report it. A missing expected refresh/expiry field is a configuration error, not a silent long-lived-token fallback.

Disconnect removes only the project's Slack binding, disables its delivery and links, and preserves message ids for operational evidence. Messages already sent remain; state this before disconnect. Delete grant ciphertext when no active binding references it. Do not call `apps.uninstall` or `auth.revoke` from a project disconnect because the installation may serve other projects. Removing/demoting an admin disables that admin's bindings; a remaining authorized admin must reconnect them under their own identity before delivery resumes.

## 6. Choosing the channel and message content

Request bot scopes `chat:write`, `channels:read`, `groups:read`. Do not request `chat:write.public`, auto-join, history, file, user profile, email, DM or command scopes. The admin invites the bot to the selected channel in Slack. Private channel support means the bot must already be a member; it never means exporting private uier feedback.

A "Load channels" server action paginates `conversations.list` with `types=public_channel,private_channel`, excludes archived channels, caps discovery at 1000 results and lists only eligible bot-member channels. Bound and sanitize names; use ids for identity. Save validates the channel again, rejects DMs/external shared channels and persists its id. If membership cannot be established from the returned metadata, do not enable sending; prove the check against a real development workspace before rollout. Renaming a channel does not retarget it.

Render messages from the authorized `FeedbackContext`; do not read raw `DbComment` or scrape the reviewed site. Include project name, public thread number when present, kind, current open/done status, bounded feedback excerpt, optional environment label, and the approved token-free uier thread link. Do not include detailed device/browser data, selectors, the complete discussion or screenshot references by default. Rewrites retain the "Suggested rewrite" label. Deleted first items have no old text.

The renderer uses Block Kit `plain_text` for reviewer text, at most 500 excerpt characters and 2500 characters overall. Include a complete short accessibility fallback, with `mrkdwn: false`, `parse: 'none'`, no `link_names` expansion, and escaped literal control characters. Generated link labels/URLs are separately validated; reviewer text never becomes a Slack mention or link instruction. Posts set `unfurl_links: false`, `unfurl_media: false` and `reply_broadcast: false` where applicable. No message metadata contains secret ids or personal data.

Screenshots stay in uier behind their existing access checks. Phase 1 posts no image URL, file upload or signed public bypass. Later image support would need its own scope, retention and cleanup plan.

## 7. Notification semantics

Slack projects current state, not the complete mutation history. A new non-private thread created after the active destination generation's `since` gets one root notification. Older or undated legacy threads establish a silent baseline unless the admin explicitly requests historical sending. New replies to an old, unsent thread do not unexpectedly export its entire historical discussion.

After a root exists, update it when its rendered content changes. Phase 2 may additionally post one thread summary per worker projection when the current status differs from the last notified status or previously unnotified reply ids exist. State the resulting status and count of new replies; do not copy reply text. Default new-thread notifications on; reply/status summaries opt-in. Ordinary edits, assignment, anchor moves, screenshots and environment changes do not create extra notification replies.

| Observed uier state/change | Slack action |
| --- | --- |
| Eligible new non-private thread | Post root, persist returned `ts`, fetch permalink separately |
| Several changes before a worker run | One current root projection and at most one selected-change summary |
| Root-visible content edited | Update known root; no separate alert |
| Non-private replies added, summaries enabled | Update root if needed; post bounded reply-count summary under root |
| Status net change, summaries enabled | Update root and post one current-status summary |
| Open → done → open before discovery | No status summary if the last notified state was open |
| Thread becomes private or is hard-deleted | Hide links immediately; delete every known app-owned summary then root |
| Thread becomes visible again | A new notification only after explicit resume for that thread; no automatic privacy-toggle alert |
| Root removed in Slack | Stop with `message_missing`; do not silently recreate an alert |
| Project done/comments off | Leave channel messages alone; project status is not a deletion command |

The last notified reply-id baseline is an id set, not a count, so deletion followed by a new reply cannot cancel detection. Summaries describe changes since the last accepted projection, not an audited event count. If a future product promises one alert per event, add a durable event stream in a separate design; `syncVersion` cannot supply it.

A privacy suppression records the reason/time and destination generation; becoming visible again does not clear it. An explicit “Resume Slack notification” admin action in the uier thread menu accepts one current project/thread/connection/generation, verifies current admin access, non-private visibility and completed known-message cleanup, and records the resume request on only that ledger. It queues a fresh authorized projection and root in the selected generation, warning that channel members will be notified. The request is single-use/idempotent under etag and cannot revive deleted threads, a disconnected binding or another provider. Resume clears the suppression only after definitive root acceptance; an uncertain root remains ambiguous. The operator recovery path uses the same bounded checks, never a bulk unsuppress or an inbound Slack button.

Privacy cleanup never exports a private packet. Shared discovery persists each target ledger's deletion intent before removing a tombstone. Cleanup uses recorded message ids, retries known targets, and records `cleanup_failed` when Slack access or authority prevents deletion. Human replies, forwarded messages, exports, already delivered push notifications and unknown messages from ambiguous writes are outside this cleanup guarantee.

## 8. Delivery worker

Implement `integrations/slack/{adapter,client,oauth,connection,message,view,config}.ts`. The shared runner owns leases, attempts, retry state, discovery and fair provider turns; the Slack adapter owns payloads, grant refresh, API classification and method/channel rate buckets. No separate Slack mutation signal or workflow is added.

Plain `fetch` uses a 20-second timeout and checks HTTP status plus Slack's JSON `ok` field. `SlackApiError` carries only a bounded code, status, optional retry delay and request id; never tokens, request/response bodies or message text. Authentication headers and OAuth exchanges are excluded from diagnostic captures.

Persist a workspace/app/method cooldown from 429 and honor `Retry-After`; sibling projects sharing that Slack workspace must not bypass it with different grants. Post at most once per 1.1 seconds per app/workspace/channel. Design budgets: at most 60 Web API calls per installation per run and a three-minute Slack turn capped by the shared allowance; count refresh, channel validation, update, delete and permalink calls too. Partial work retains its exact step and known ids for the next run. Cleanup is prioritized within that allowance.

| Result | Action |
| --- | --- |
| Definitive `ok: true` post response | Persist channel/`ts` before any later call; no repeat post |
| Definitive 429 rejection | Keep attempt waiting; retry after persisted method/workspace cooldown |
| `token_revoked`, `invalid_auth`, `account_inactive` | Stop grant delivery, wipe unusable credentials, require reconnect |
| `not_in_channel`, `is_archived`, `channel_not_found`, `missing_scope` | Pause that binding/grant as appropriate; no repeated posting; explicit channel/reconnect recovery |
| Update timeout/5xx with known `ts` | Retry the same full desired update with backoff; no new message |
| Delete timeout/5xx with known `ts` | Retry same known target; `message_not_found` means that target is gone |
| Post timeout, connection loss after send, or possibly partial internal error | `ambiguous`, stop this ledger for operator review; do not blindly post again |
| Known root `message_not_found` on update | `message_missing`; hide link; explicit recovery required |
| Eight definitive transient failures | Inactive `failed` ledger for manual retry; other providers continue |

`client_msg_id` is not an exactly-once guarantee. Phase 1 does not depend on undocumented dedupe retention or a blind replay with the same id. A timed-out successful post can leave an orphan Slack message whose `ts` uier never received. This limitation and the resulting privacy-cleanup gap must be visible in operator documentation and exercised by the stub.

Operator resolution inspects the selected Slack channel under the operator's own access. Confirm the exact app-owned message and uier source reference before recording its known id, or confirm no message exists before authorizing a replacement attempt. This is a concrete recovery decision, not an automatic retry. Do not add broad history permissions or adopt a human message. A permalink failure after a confirmed post retries only permalink retrieval; it never repeats the post.

## 9. App UI

Add `components/app/slack/SlackSection.tsx` inside the admin-only Integrations group using existing shadcn components. The page receives only `SlackConnectionView`: status, bounded team/channel names, notification choices, last accepted time, queued/review counts and bounded error codes. No grant document, tokens, Slack user ids or refresh state reaches HTML, RSC, action results or DTOs.

| State/action | Proposed copy |
| --- | --- |
| Not connected | Connect Slack, then choose the channel that receives this project's notifications. |
| Destination | Invite uier to the channel in Slack, then load channels. |
| Enable | New comments are sent to this channel. Private comments are not sent. |
| Choices | New comments; reply summaries; status summaries. Replies and status summaries start off. |
| Timing | Notifications are batched and may take a few minutes. |
| Off | Notifications are off. Changes are queued until you turn them on. |
| Pause | uier cannot post to this channel. Check its access or choose another channel. |
| Ambiguous | Slack may have received this notification. An operator must check it before retrying. |
| Privacy limitation | uier can remove its known messages when access allows. Copies and human replies may remain in Slack. |
| Resume thread | Send a new notification for this comment. People in the selected channel may be notified. |
| Disconnect | Stop sending notifications. Existing Slack messages stay in the channel. |

A separate "Send test notification" action requires explicit admin activation, posts a generic no-feedback message using the same budgets, and records its id for optional removal. Saving channel/settings does not send test feedback. Do not render unavailable future features or a delivery guarantee.

Use the shared `ExternalFeedbackLink` (`provider: 'slack'`) and `integrationLinks` loader, not `ProjectCommentView.slack`. Fetch `chat.getPermalink` after a successful root and allowlist HTTPS Slack workspace hosts. Expose links only for currently visible non-private threads with an active binding and known live root; guests/public showcase receive none. Slack independently enforces access to the destination channel.

## 10. Infrastructure and configuration

Proposed production-only variables are `SLACK_CLIENT_ID`, sensitive `SLACK_CLIENT_SECRET`, sensitive `SLACK_TOKEN_KEY`, and `SLACK_APP_ID`. `SLACK_TOKEN_KEY` is a separate protected 32-byte Pulumi-generated encryption key. Keep provider grant ciphertext bound by AES-GCM AAD to provider, uier workspace, grant identity and token field. Rotation keys stay independent of `UIER_COMMENTS_SECRET`.

`SLACK_API_BASE_URL` and `SLACK_OAUTH_AUTHORIZE_URL` have fixed production defaults and local/e2e overrides only; never permit an admin-controlled API endpoint. `isSlackConfigured()` includes credential availability and the rollout gate. Previews get no real Slack credentials or registered callback. The production callback is `https://uier.io/app/slack/callback`; developers use a separate Slack app and registered local callback for testing.

Infra is applied through CI only. Future implementation updates `infra/src/index.ts`, `.github/workflows/{pulumi_reusable,ci,deploy}.yml`, `.env.example` and secret documentation. The existing `Review notifications` job invokes the shared integration worker after email and receives production configuration through its existing trusted path. No `pulumi up` runs locally.

The owner creates the Slack app with brand assets, the three bot scopes, rotation configured only after validation, no user scopes, no Events API, no interactivity URL and no incoming webhook. Complete distribution requirements before customer enablement; a development app installation is sufficient only for the controlled acceptance fixture.

## 11. Security and privacy

Each send checks current project ownership, connecting admin membership, enabled destination generation and thread visibility. A provider scope or private Slack channel never expands uier's export permissions. Prevent source text from creating `@channel`, `@here`, user mentions, arbitrary image loads or link unfurls. Treat channel names, Slack errors and feedback as untrusted data.

Rotation uses the global installation operation lease and the single referenced grant; refreshing one binding cannot invalidate another binding's copied token. Disconnecting one project does not uninstall the Slack app. Grant invalidation stops all dependent bindings; admin removal stops that admin's bindings before decryption. Cross-workspace grant reuse is denied by the global installation-owner claim in the first release.

On shipping, add exact Slack wording and the effective date to the Connected services privacy section: the admin chooses the channel; uier sends bounded feedback excerpts, project/thread labels, status, optional environment, selected-change counts and approved links; it stores encrypted installation credentials, destination identifiers, message ids/hashes and delivery state. No screenshot, detailed browser data or full discussion is sent in this plan.

The consent copy states that Slack channel membership may include people without uier membership. Disconnect does not remove messages. Best-effort deletion concerns app-owned messages with recorded ids; it does not recall notifications or erase human copies, channel retention, exports or legal holds. An ambiguous post can remain without a recoverable id. Do not describe Slack as a processor or make transfer/retention claims without the shipped legal review and applicable service terms.

Log only provider, ledger id, bounded code and aggregate counts. Keep secrets and message bodies out of traces and stub exports. Do not add Slack domains to browser CSP: OAuth is a server redirect and Web API requests run on the server. No new cookie is needed; OAuth state remains a short-lived server document.

## 12. Testing

Use an isolated `apps/web/e2e/support/slackStub.ts`; inject its base URL only in local/e2e configuration. The stub models OAuth v2, rotating grants, channel membership/metadata, posting/updating/deleting owned messages, permalinks, JSON `ok: false`, HTTP 429 and response-loss after a successful write. Test instances inspect their own ids rather than shared global counters.

| Suite | Required evidence |
| --- | --- |
| Shared `integrations.api.spec.ts` | Fan-out survives partial upserts; Slack rate limits, ambiguity and grant expiry do not stop Notion/GitHub/Linear; Slack disconnect preserves other bindings; Slack historical send does not enqueue other providers |
| `slackOauth.api.spec.ts` | Single-use provider/user/workspace/project state, denial, invalid session, missing scopes, wrong app/team, unsupported org install, no user token, concurrent cross-workspace owner claims, same-operation setup replay/rollback, rejected reinstall without revoking the active installation, explicit ownership transfer with drained leases, shared owner/grant generation, admin removal, refresh races and crash-after-refresh recovery |
| `slackTransport.api.spec.ts` | HTTP and `ok` errors, Retry-After buckets across sibling projects, per-channel pacing, timeout classification by operation, no blind post retry, update/delete same known target, permalink-only retry, redacted errors/logs |
| `slack.api.spec.ts` | One root per new eligible thread; old/undated baseline; coalesced status toggles; optional reply-id summary detection; edits do not alert; latest state wins; privacy cleanup of every known bot message; unknown orphan acknowledged; visible-again stays suppressed until a single-use authorized resume; private/deleted/wrong-generation resume fails; ambiguous resume does not repost; deleted Slack root stays missing; channel switch establishes a new cutoff and an old thread's later edit stays silent |
| `slackMessage.api.spec.ts` | Literal `<@U…>`, `<!channel>`, `@here`, malicious URLs, control/bidi characters and HTML stay inert; field limits, rewrite/deletion labels, no images/device detail, complete fallback, unfurls and broadcasts disabled |
| `slack.spec.ts` | Desktop/mobile connect/pick/save/off/reconnect/disconnect, admin-only controls, explicit test post, default summary choices off, bounded admin-only per-thread resume and confirmation, safe RSC/HTML, member-only external link, light/dark accessibility |

Live acceptance uses the owner's controlled Slack workspace after the distribution gate appropriate to that test. Prove a public and bot-invited private channel; an uninvited channel; a renamed and archived channel; two projects sharing the installation; token refresh across the two; admin removal; no mention/unfurl from hostile text; update/delete ownership; and observed recovery of a deliberately uncertain post. Record actual observed timestamps and API results separately from CI or deployment success.

## 13. Documentation changes

When implementation ships, add `docs/slack-integration.md` describing the channel membership steps, scope rationale, notification coalescing, defaults, batching caveat, rate-limit buckets, ambiguous-post operator recovery, cleanup/retention limitations and acceptance evidence.

Update the README integration/settings/configuration/record tables, `apps/web/AGENTS.md` shared integration adapter and testing rows, `infra/AGENTS.md` protected credentials, `.env.example`, privacy/terms/security copy and the toolbar's generic external-link guide. Keep the common adapter contract in the shared guide; do not duplicate the pending-discovery protocol for Slack.

These planning documents do not announce shipped functionality or change the current legal pages. Those pages change with the implementation PR that begins sending data.

## 14. Phases

Phase 0: prove the distribution path and a development Slack app; verify scopes, bot membership checks, shared installation reuse, rotation/reinstall behavior and exact message ownership rules. Exit with an owner decision and captured API fixtures. Do not enable customer connections before the applicable Marketplace/distribution gate passes.

Phase 1: credentials, grant/connection flow, channel selection, shared worker adapter, new-thread root posts/updates, privacy cleanup, explicit bounded per-thread resume, ambiguity stops, operator recovery and the settings form. Include test stubs, live fixture acceptance, production-only infra through CI and matching legal copy. Exit: one controlled thread produces one root; edits update it; cleanup deletes known messages; two projects share refresh safely; conflicting workspace claims and interrupted claim/grant writes recover idempotently without revoking another binding; response loss does not cause an automatic duplicate. Existing threads stay silent.

Phase 2: opt-in reply/status summaries and app/toolbar external links. Exit: several changes produce at most one summary per projection; open/done/open coalesces honestly; deleted/re-added replies are detected by identity; each known summary is cleaned up on privacy changes; guests see no link. Run the shared provider-isolation suite.

Phase 3: explicit historical send and operational polish. Default off, newest 100 eligible threads per invocation, 20 queued per run, provider-scoped queue and explicit warning that notifications will appear in the channel. Exit: a bounded fixture resumes after restart without re-posting accepted roots and without triggering another provider. Higher volume, channel digests, image uploads and inbound actions require separate designs.

## 15. Risks and open questions

Assumed defaults are decisions for planning; a change must update behavior, tests and consent copy together.

1. Marketplace/distribution eligibility and owner: repository owner verifies the applicable customer distribution path before rollout.
2. One channel per project and one uier workspace per Slack installation initially, enforced by a conditional global owner claim and generation-fenced operation lease. Concurrent first-install effects on an existing Slack credential pair remain a live gate; cross-workspace transfer is explicit, not a new local grant lookup.
3. Token rotation on for the first production app after tests, with explicit reconnect on lost refresh persistence; long-lived fallback is not automatic.
4. Public and bot-invited private channels supported; Slack Connect, DMs, Enterprise org installs and GovSlack deferred.
5. New threads notify by default; status/reply summaries are opt-in and coalesced. Every-event delivery would require a different durable signal.
6. No history read permissions: a post with an uncertain result stops for operator review. This can leave an orphan copy and requires an explicit replacement/adoption decision.
7. Messages deleted manually in Slack remain missing until explicit recovery; no surprise recreation.
8. Cleanup deletes only known app-owned messages. Loss of channel access, human copies and prior notifications can prevent complete removal.
9. Historical send off by default, capped at 100 newest eligible threads. Raising that cap needs measured rate/batching acceptance.
10. Channel switches preserve retired message ids without automatic historical replay. Old-channel cleanup is an explicit operation while the old authorization remains available.
11. Authorization/privacy can change between the final read and Slack's write; recheck before each call, then converge cleanup on the next pass. Do not claim a cross-system atomic privacy transaction.

## 16. Decision log

- Slack is a notification adapter, with a current root and optional bounded summaries, not a Notion-style complete content mirror.
- Reuse shared discovery, leases, backoff, provider fairness and external-link DTOs. Email's unread/event semantics remain independent.
- Use a bot installation and explicit channel membership. Do not add permission to post everywhere or read channel conversations.
- A global installation-owner claim selects one uier workspace/grant; project connections reference that grant. Conditional reservation/finalization, rollback, transfer and refresh generation checks prevent independent retained refresh loops.
- Destination switches establish a new silent baseline and cutoff. Visible-again threads need an explicit bounded uier admin resume before another channel notification.
- Prefer honest ambiguity and manual recovery over an unverified `client_msg_id` exactly-once promise or blind post retries.
- Render reviewer content as inert bounded text, suppress mentions/unfurls, and keep screenshot access inside uier.
- Treat private transitions/deletions as known-message cleanup with stated limits; disconnect leaves Slack messages in place.
- Customer enablement depends on the applicable Slack distribution gate and observed live acceptance, not solely a green pipeline.
