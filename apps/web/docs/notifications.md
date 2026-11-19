# Review notifications

Review notifications live in `src/lib/notifications/`. Event metadata is part of the same comment
write as the shared unread activity cursor. Never send email from a toolbar client or detached
promise. A private Vercel Schedule named `review-notifications` runs the awaited Cosmos-backed
production worker every five minutes. It uses the existing web app identity and production
containers, not the privileged manual worker's preview scopes. Dispatch rechecks access, private visibility, subscription,
mute and `getReadSequence`; keep the optional verified guest flow separate from posting. See
`docs/review-notifications.md` for the event/delivery contract and failure evidence.
`notificationEvents` remains delivery metadata, independent of the bounded, member-visible
[`history` log](read-state-and-activity.md#thread-history). History retention never trims or rewrites
notification events. Priority, privacy, movement and AI title history do not introduce email events;
existing assignment, status, verification and MCP agent event delivery keeps its current contract.
[File threads](proof-review.md) recheck the live asset and recipient at dispatch. A verification
reminder follows the pending request's version. Superseded, archived and disabled checks are
skipped. Member links use app authentication. Guest links use a separate, expiring
mailbox credential bound to an active, verified subscription and the original
file and share. Unfollowing invalidates the credential and any returning sessions
based on that subscription. See [returning guest review](proof-review.md#returning-guest-review).
`/api/email/reports` checks its secret header and expected Event Grid subscription before validation
or writes. Compare the subscription name case-insensitively, as Azure resource identity requires.
The per-subscription credential and expected name bind the handshake to the subscriber; do not
treat validation topic metadata as identity.
Delivery reports must additionally use the configured ACS topic. Rejection logs contain only
bounded reason codes, never header values, addresses, payloads or provider status messages. Bounces suppress only by normalized address hash and bounded reason; report
receipts retain hashed event/operation ids for 30 days and survive a mailbox confirmation. No raw
provider message, address or report payload may be logged. Skip suppressed digests; a failed read
must retry. Show the generic notice only in the admin invite action. Requested sign-in/guest
confirmation remain available and clear suppression only on completed mailbox proof. Ledger
matching is production-gated until live message-id correlation is proven.
`scripts/scheduled-worker.ts` is a standalone Fetch handler using `@vercel/schedules.handleSchedule`.
The build-output artifact exposes it only to `schedule/v1beta`, with no public HTTP route. It accepts
only the fixed static schedule in namespace `default`; environment `production` is a separate
deployment check. Request bodies and query strings cannot select preview access, a retry id or
different work. Private invocations carry their Azure OIDC assertion in request-scoped
`AsyncLocalStorage`; never copy assertions into `process.env`. The app's normal credential path
still uses Vercel federation and retains its existing production screenshot settings.

`src/lib/worker/run.ts` is the shared host-neutral orchestrator. It validates data access before
mutation and awaits each phase. Its global `worker:review-notifications` lease in `app` replaces
the schedule's process-local concurrency assumptions. Acquisition and release use etags and a
random owner; a stale process cannot clear a successor's lease. Its 15-minute expiry exceeds both
the native function's 800-second hard cap and the manual Actions job's 13-minute hard cap.
Never race unfinished work against a timeout and release that lease early. A busy native turn
returns without mutations; the next five-minute occurrence retries pending work.

The cooperative budget is 12 minutes including access verification. New phases stop after it;
notification discovery/delivery checks its own deadline between candidates, with a maximum
three-minute turn. Discovery and TTL adoption reserve the last third of that turn (up to a minute)
for already-due deliveries. Integrations retain their existing eight-minute maximum while reserving
the last minute for MCP events. Remaining pending flags and delivery ledgers survive the turn.
An in-flight store/provider operation can finish after a cooperative deadline; the host's hard
duration limit and longer global lease still prevent a replacement from overlapping it.

The **Review notifications** GitHub workflow has no schedule. Manual `workflow_dispatch` retains
privileged preview/legacy maintenance and operator recovery, packaged before credentials are
loaded, then run without a checkout in `production-worker`, a main-only environment with no
approval gate. Its separate Azure app retains OIDC plus `AzureCliCredential` and its original
preview data scopes; the Vercel identity receives none of those additional permissions.
Manual recovery shares the global lease and reports a busy result rather than overlapping a
native turn. It still accepts no Cosmos/Blob account key or dotenv file.
`UIER_WORKER_SETTINGS` contains only allowlisted data, transport and integration-crypto settings;
`scripts/worker-settings.mjs` masks each value before loading it, except the `"0"`/`"1"`
`SLACK_DISTRIBUTION_APPROVED` gate (masking `1` hid exit codes and delivery ids). Only a run's own
failed or ambiguous attempts fail it; ledgers already waiting for review are named as warnings with
their `retry_delivery` id on every run. No Vercel token or environment
pull is available. Refresh the snapshot after credential/crypto changes with
`pnpm -C infra exec node scripts/configure-worker.mjs`; never replace app keys to repair a worker.
Every run validates only its host's data scopes first; manual `verify_only` stops before writes,
including lease acquisition, or dispatch. Native verification probes only `comments`, `app` and
`screenshots`; manual verification includes the existing preview containers too.
`integrations_only` manual runs skip email and reject a simultaneous email retry.
MCP event webhooks are swept after integrations on every run except `verify_only` (up to 60 seconds within the remaining turn budget); a
subscriber's failing endpoint never fails a run, only an unexpected worker error does.
GitHub Settings can reuse installations known to the current
workspace, but fresh PKCE user authorization and repository administration checks remain required.

`e2e/scheduledWorker.api.spec.ts` guards cross-host lease races, expired-owner release, read-only
verification, cooperative deadline handling and concurrent assertion isolation.
`e2e/notificationWorker.api.spec.ts` exercises both the native CloudEvent boundary and manual
worker modes with isolated transports; production functions never enable those substitutes.
Digest unsubscribe headers are persisted in `attempt.message.headers`; retries preserve them.
`/api/notifications/unsubscribe` changes state only on a cookie-free RFC 8058 POST; GET and
`/notifications` remain read-only. Never accept verify tokens for unsubscribe/mute.
Digest wording uses only the recipient's eligible batch and current authorized participant names;
never name other mention/assignment recipients. Events store item/new-assignee ids, never text.
`emailCommentExcerpts` defaults off and is saved through `adminProject`; commenters see its state.
New attempts rebuild from fresh settings/items at the send boundary; retained provider operations
keep their exact message, which can retain opt-in excerpts until reconciliation without a TTL.

uier’s own feedback projects retain every event for MCP, including web-app actions with no
connector attribution, while keeping `notificationPending` false to avoid owner email jobs.
Event recording does not depend on whether anyone is eligible for an email.

Connector replies are distinct from their human owner for unread indicators and read suppression.
Non-reply operations through the owner’s connection use their human activity identity and never
acknowledge earlier unseen activity.
Notification events retain the real account actor and existing self-recipient exclusions: this
unread change does not introduce emails to the connector's owner. See
[read state](read-state-and-activity.md#read-cursors-and-freshness).
