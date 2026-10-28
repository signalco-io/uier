# Review email notifications

Project creators and workspace admins receive new top-level feedback by default, while they
retain access to it. Members automatically follow threads they
post in; any authorized member can follow or unfollow a thread explicitly. Replies and
resolve/reopen activity go to followers. A project mute stops all its notification emails
for that member, including targeted activity. The actor never receives their own activity.
The toolbar and app expose follow/unfollow and project mute/unmute.

Guests can still comment using just a name. After posting, a separate **Email me replies**
control requests an address. A confirmation email expires in 24 hours and requires an explicit
button click; opening the link does not subscribe. Confirmation follows only that thread and
only future activity. Subscription does not create an account or grant project access.
Verification requests are limited to five per address and guest per hour, and twenty per IP
bucket per hour. Unsubscribe removes the address from the guest subscription immediately. Signing out clears the browser
identity but does not unsubscribe an already verified address; use its email unsubscribe link.

## Activity and delivery contract (#83, #84, #91)

- `DbComment.activity.sequence` is the monotonic thread cursor owned by #83. The authorized
  `getReadSequence(domain, actorAuthorId, threadId)` service is the only seen cursor used for email.
- `notificationEvents` contains `{sequence, actorId, kind, at, recipients?, agent?, itemId?, assigneeId?}` metadata, without
  message text or images. `itemId` identifies the comment/reply/mention item; `assigneeId` records
  the new assignee account id (explicit `null` for unassignment). `agent` retains connector
  attribution. Older events can omit these fields. It is written atomically with the comment mutation and shared activity
  sequence; `notificationPending` requests durable discovery. Safe submission retries commit the
  same event and activity cursor with the idempotency receipt, so a lost response cannot duplicate
  an event. Legacy activity is not replayed.
- Kinds are `comment`, `reply`, `resolved`, `reopened`, plus `mention` and `assignment` for #91.
  Targeted events may include server-validated `user:<userId>` recipients. Their producer must
  advance the shared activity cursor and append the event inside the same etag-protected write.
  An event never grants access. Explicit unfollow and project mute still apply to targeted events.
- Each actor/thread has one `notification-delivery` ledger in `notifications:<projectId>`, tracking
  `requestedThrough` and `processedThrough`, an optimistic lease, the current provider operation,
  retries and a bounded failure code. Discovery writes ledgers before clearing the pending flag;
  concurrent activity leaves the flag set for a later run.

The digest window starts at the first eligible unread event and lasts five minutes. Activity in
that window is delivered together, with a direct link to the thread on its original authorized
page, retaining the shared approved query/hash state. Later activity forms the next digest.
The scheduled **Review notifications** GitHub Actions workflow runs every five minutes on main;
GitHub can delay scheduled jobs, so five minutes is a batching window, not a delivery guarantee.
It can also be run manually. It uses the existing Vercel production configuration, Cosmos DB
containers and Azure Communication Services sender; it creates no new infrastructure.

Before each attempt, the worker reloads current project access, membership, private-thread
visibility, subscription, mute and read cursor. Removed members, disabled projects, guests on
invited-only projects, hidden/deleted threads and already-read activity are suppressed.
Bulk Mark all as read uses the same per-thread read cursors, so queued deliveries suppress events
at or below each successful cursor. Failed writes and replies newer than the rendered list retain
their eligibility; bulk acknowledgement needs no new notification storage.

Emails name the actor, action and page for each eligible event. A mention says "mentioned you";
assignment says "assigned #N to you" or "unassigned you from #N", without naming other recipients.
Guests are explicitly labeled as guests; removed members become "Former member" and missing
guest names become "Guest". Connector actions include "via <connector>". A digest shows at most ten
event lines, then "and N more". Multiple-event subjects summarize counts, rather than listing names.
Subjects include the project, thread number (when present) and pathname, without query/hash state.
Each name, connector label, project name and pathname used in a subject/body action line is limited
to 60 Unicode code points (below `MAX_NAME_LENGTH`, 80), with an ellipsis included in that limit.
Control/format/line separator characters become spaces and whitespace collapses. Untrusted names
and paths are plain text, never generated links; `layoutEmail` HTML-escapes them.

Comment text stays out of digests by default. **Include comment excerpts**, in project settings
under **Email notifications**, is off for new and older projects. Only workspace admins can save
it (the server action calls `adminProject`); commenters can see its state. Enabling it sends excerpts
to every recipient, verified guests included. With it on, a comment/reply/mention event with an
`itemId` may include up to 160 Unicode code points of that item's current plain text. Excerpts
never appear in subjects. Deleted items, older events without an item id, status and assignment
events have no excerpt. Quoted page text, screenshots and reproduction details never enter a digest.
Before a new attempt's first provider request, the worker reloads the project, recipient eligibility
and items and rebuilds the message, honoring settings changes, edits and deletions during preparation.
An attempt retained from a previous run keeps its exact message for provider repeatability. Opening a link still requires the recipient's normal authorized toolbar/app identity.
A guest must use the browser/site identity they commented with to see their private thread.

## Retry and failure evidence

All work is awaited by the scheduled process. Cosmos retains queued work across deployments and
worker restarts. A deterministic actor/thread ledger, shared event cursors and an optimistic lease
prevent concurrent workers or repeated discovery from delivering an activity twice. Before sending,
the ledger stores the exact message, ACS operation UUID and first-send timestamp. Retries query that
operation first, using the ACS status endpoint. Repeated initial requests use the same UUID and
repeatability headers; confirmed provider failures may start another operation with exponential
backoff (up to one hour, eight failures).

ACS repeatability lasts five minutes. If an interrupted initial send has no observable operation
after that window, its outcome is ambiguous. The ledger stops for review instead of starting an
unrelated operation that could duplicate mail. Failed or ambiguous ledgers retain their operation
and failure class; the workflow reports their count and fails. Logs identify only the delivery id
and bounded failure code, without recipients or message content. ACS acceptance is not proof of
inbox delivery. The authenticated delivery-report receiver below processes provider reports once its subscription is deployed.

Provider references: [ACS repeatable requests](https://learn.microsoft.com/en-us/rest/api/communication/repeatable-requests)
and [email operation status](https://learn.microsoft.com/en-us/rest/api/communication/email/email/get-send-result?view=rest-communication-email-2025-09-01).

After correcting a delivery configuration error, run the workflow manually with `retry_delivery`
set to the id shown in the failure log. A confirmed failure gets another bounded retry cycle.
An ambiguous operation retains its original id and only reconciles with ACS; it never starts an
unrelated send. Check the provider's operation evidence before considering any manual data repair.

Unsubscribe/manage links are purpose-signed capabilities that cannot sign in or read comments.
GET is read-only; changes require a POST action. Digest headers additionally point to the cookie-free `/api/notifications/unsubscribe?token=...` endpoint. A form POST containing only `List-Unsubscribe=One-Click` applies thread unsubscribe or project mute with no redirect. Repeated POSTs succeed; expired, superseded and confirmation tokens cannot unsubscribe. Member digests link to thread unsubscribe when
there is an explicit subscription, otherwise to project mute. Manage links expire after a year;
the toolbar/app always offers current controls. Changing a subscription invalidates older links.

Pending guest addresses expire after 24 hours. Verified subscriptions and preferences persist until
revoked; unsubscribe deletes the guest address. Event metadata and delivery evidence remain with
the project until removed; event metadata never duplicates comment content. With excerpts enabled,
the persisted `attempt.message` contains comment text. A failed/interrupted or ambiguous attempt
that retains a message keeps that excerpt until reconciliation, successful acceptance, suppression
or explicit removal of the ledger/project; there is no automatic expiry. Editing/deleting an item
or disabling excerpts does not rewrite a prior-run attempt. Confirmed provider rejection clears
the attempt, so a later fresh attempt uses current settings/content. Failed or uncertain provider
attempts can retain the addressed pending email until reconciled; unsubscribe still prevents further sends. Preview/local deployments follow
the existing no-mail model and expose verification links for testing; the scheduled worker runs
only against production.

## Validation

`notifications.api.spec.ts` exercises the production services with isolated local stores and a
controlled transport: owner and participant delivery, verification, batching, shared read-cursor
suppression, unsubscribe/mute, private/revoked access, provider failure, interrupted-send recovery
and duplicate/concurrent discovery. Browser coverage checks the optional guest flow, explicit
confirmation, member controls, light/dark UI and accessibility.


## Email reports and address suppression (#132)

`POST /api/email/reports` requires the secret `x-uier-email-report-secret` header, the exact
`aeg-subscription-name`, and the configured ACS resource `topic` (case-insensitive Azure resource id) for reports.
The per-subscription secret and exact event-subscription name bind validation to the expected
subscriber; validation topic metadata is not used as identity. Other event-subscription names and
missing credentials remain rejected. Delivery reports additionally require the exact ACS topic.
All three are configured for production only by Pulumi. `acsEmailReports` delivers only report
events with that secret static header, one event per batch, retrying up to 30 times / 24 hours. Validation accepts only a single
`Microsoft.EventGrid.SubscriptionValidationEvent` from that subscription/topic and echoes its
code; it never follows the supplied validation URL. Notifications accept only the ACS delivery
report event type, at most 100 reports / 256 KiB. Failed storage writes return 503 so Event Grid
retries; success returns 200 without a body. No raw report, recipient, status message or content
is logged or retained.

`Bounced` and `Suppressed` create an `email-suppression` document in
`email-reports:<sha256(trim(lowercase(address)))>`, with only the hash and one of those two reasons
besides its document keys/type. Digests check this store again at the send boundary and mark their
ledger `suppressed` / `address_suppressed`. Failed reads use the existing bounded exponential
backoff instead of sending. Only the admin invitation action reveals the generic bounced-address
notice; no date or workspace is disclosed. It refuses the invitation before creating its token.
Sign-in and optional guest confirmation requests keep their existing rate limits and responses;
completed mailbox proof clears uier's suppression. ACS's temporary suppression is independent.

Hashed event-id receipts (30-day TTL, longer than Event Grid's delivery retry window) survive
clearing a suppression, so duplicate old reports do not suppress it again. Receipts also retain
a SHA-256 operation-id hash for production correlation without retaining the report payload.
The first suppression and receipt commit in one Cosmos transaction. Existing suppressions need
no update; a later distinct report may suppress the address again.

`Failed`, `Quarantined` and `FilteredSpam` never suppress an address. Operation matching is guarded
by `UIER_EMAIL_REPORT_MATCH_OPERATIONS=1`, which is deliberately absent from production until the
live correlation gate below is evidenced. When enabled, a report updates only `lastCode` to
`ACSReport_<status>` on a ledger whose current `lastOperationId` equals `messageId`. Unknown ids
are acknowledged without creating a ledger. A report does not trigger a fresh send. Enabling the
gate requires a separate reviewed Pulumi environment-variable change; local tests explicitly
exercise the enabled behavior. Earlier acknowledged reports are not replayed automatically.

Every digest persists `List-Unsubscribe: <https://uier.io/api/notifications/unsubscribe?token=...>`
and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` in `attempt.message.headers` before ACS.
Retries retain that exact message. Sign-in, invitations and guest confirmation omit both headers.
Engagement tracking stays disabled. Sending the headers does not prove that a mailbox offers
one-click: [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html) requires both to be covered by a
valid DKIM signature. [The September 2026 ACS report](https://learn.microsoft.com/en-us/answers/questions/5996924/acs-email-dkim-signature-does-not-cover-list-unsub)
observed ACS omitting these from `h=`. Our own received-message evidence remains pending.

### Staged rollout and live evidence

1. Deploy the receiver, production-only credential/topic/subscription variables, customer domain
   and DNS with the Azure-managed sender unchanged. The first PR creates no Event Grid subscription.
   This ordering matters: deploy.yml applies Pulumi before deploying the new website.
2. Confirm the production endpoint rejects unauthenticated calls (401), then create the Event Grid
   subscription in a separate PR. Filter to `Microsoft.Communication.EmailDeliveryReportReceived`,
   Event Grid schema; deliver the secret as a secret static header. Check subscription provisioning
   succeeded. `Microsoft.EventGrid` was read back as `Registered` on 28 October 2026.
3. Run the main-only **Verify email domain** workflow for one-time Azure DNS verification. Only after all five
   verification states are `Verified`, review an in-place linkedDomains update retaining the Azure
   domain, then switch `UIER_EMAIL_SENDER` to `DoNotReply@uier.io`. Never replace the communication
   service or its connection string.
4. Obtain explicit permission for a recipient and send a real digest through the production worker.
   Record the operation UUID privately and independently read the matching report receipt's
   operation hash. Prove the report `messageId` equals the actual send operation id before enabling
   production ledger matching. Never infer this from API examples or local tests.
5. Inspect the received original message, recording only redacted authentication/header evidence:
   SPF, DKIM and DMARC pass, both unsubscribe headers intact, and whether DKIM `h=` covers both.
   Do not commit recipient addresses, body, tokens, or raw headers containing them.

| Production gate | Evidence as of 28 October 2026 |
| --- | --- |
| Event Grid provider registered | Verified by Azure read-only inspection |
| Existing SPF/DMARC preflight | Authoritative Cloudflare DNS returned neither apex SPF nor `_dmarc` TXT |
| Receiver deployed and authenticated | #163/#174 deployed; unauthenticated production POST returned 401 |
| Subscription handshake/delivery | Authenticated readiness passed; Azure callback rejected as unexpected_subscription; paused for resource-name comparison repair |
| Domain/SPF/DKIM/DKIM2/DMARC verified | First four Verified; DMARC NotStarted because Azure rejects its documented verification type |
| In-place link and sender cutover | Blocked on DMARC verification; Azure-managed sender retained |
| Report messageId / operation id correlation | Pending recipient-authorized production digest |
| SPF/DKIM/DMARC and headers at receiver | Pending recipient-authorized production digest |
| DKIM covers unsubscribe headers | Unverified for uier; ACS limitation reported above |

Local coverage includes `emailReports.api.spec.ts` (auth, expected handshake, duplicates, write
failure and unknown/matching operations), `notificationTransport.api.spec.ts` (ACS headers and
retry preservation), `notifications.api.spec.ts` (bounce, failed reads, one-click and invalid
capabilities), `users.spec.ts` (admin notice) and `app.spec.ts` (requested sign-in clears suppression).
Issue #132 remains open until the production gates are resolved.


The first #163 deployment stopped before Vercel deployment because Azure's live 2026-03-18 custom
Domain response supplied Domain/SPF/DKIM/DKIM2 records but omitted DMARC (its state was `NotStarted`).
The repair keeps supplied records authoritative and uses the explicit owner policy
`_dmarc.uier.io TXT "v=DMARC1; p=reject"` when DMARC is absent. Authoritative DNS still had no DMARC
record before that repair. This follows [ACS sender authentication guidance](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email/email-authentication-best-practice)
for rejection of unauthenticated mail; it does not invent an aggregate-report mailbox. All five
Azure verification states are still required before any sender cutover.


The main-only [verification run](https://github.com/signalco-io/uier/actions/runs/40742143767)
verified Domain, SPF, DKIM and DKIM2, then the documented 2026-03-18 `initiateVerification` request
for `DMARC` returned `InitiateVerificationFailed: Invalid verification type: DMARC`. Independent
Azure readback confirmed DMARC is still `NotStarted`. The public DMARC record exists, but it does
not satisfy the issue's Azure verification gate. Keep the guarded cutover PR unmerged until this
provider-side inconsistency is resolved; do not weaken the guard or manually change protected
infrastructure. The receiver deployment completed successfully in
[run 40741903769](https://github.com/signalco-io/uier/actions/runs/40741903769), and the public report
endpoint rejected a credential-free POST with 401. Production message-id/authentication/header
checks still require an authorized recipient and remain unverified.


The first subscription creation in [run 40743676944](https://github.com/signalco-io/uier/actions/runs/40743676944)
was rejected with 403. Vercel request evidence confirms the request reached the serverless receiver;
the expected subscription name is configured. The likely cause is the original topic check rejecting Event Grid's
[documented subscription-root validation topic](https://learn.microsoft.com/en-us/azure/event-grid/end-point-validation-event-grid-events-schema).
The receiver now accepts only its configured ACS topic or that topic's Azure subscription root for
validation, while reports continue to require the ACS topic. The secret and expected subscription
name remain mandatory. Rejections expose only bounded reason codes, never headers or report data.
Subscription provisioning is paused for this receiver deployment and must be re-enabled in a later
infrastructure PR after the fix is live. The Azure-managed sender remains unchanged.


A second subscription attempt in [run 40747762369](https://github.com/signalco-io/uier/actions/runs/40747762369)
still received 403 after the subscription-root compatibility change. The first topic hypothesis
was not sufficient. Firewall inspection found no custom configuration, bypasses or Attack Mode;
a local request with Azure's documented headers/body reached the handler and returned 401 for an
invalid credential. Validation now binds identity to the per-subscription secret and exact
`aeg-subscription-name`, as the official handshake guidance prescribes. Source topic metadata is
not an identity check for validation; delivery reports retain their strict ACS-topic check.
Bounded rejection logs make any further mismatch observable without retaining header values or
payloads. Provisioning is paused until this receiver revision deploys, then resumed through CI.


The guarded subscription attempt in [run 40754446941](https://github.com/signalco-io/uier/actions/runs/40754446941)
passed its authenticated validation-only readiness probe, then Azure's real callback reached the
deployed receiver and logged only `unexpected_subscription`. This rules out the prior topic and
WAF hypotheses for that attempt. The byte-sensitive name comparison conflicts with
[Azure's resource identity rules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules),
which require case-insensitive comparison and allow returned casing to differ. The receiver accepts
only the same name ignoring case, retains the per-subscription secret and strict report topic, and
logs only bounded missing/other-name or case-normalization codes. Raw headers are never logged.
Creation is paused until this receiver deploys, then resumed through a separate reviewed PR.
Actual callback name casing is not yet proven; independent provisioning readback remains required.
