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
bucket per hour. Unsubscribe removes the guest email immediately. Signing out clears the browser
identity but does not unsubscribe an already verified address; use its email unsubscribe link.

## Activity and delivery contract (#83, #84, #91)

- `DbComment.activity.sequence` is the monotonic thread cursor owned by #83. The authorized
  `getReadSequence(domain, actorAuthorId, threadId)` service is the only seen cursor used for email.
- `notificationEvents` contains `{sequence, actorId, kind, at, recipients?}` metadata, without
  message text or images. It is written atomically with the comment mutation and shared activity
  sequence; `notificationPending` requests durable discovery. Legacy activity is not replayed.
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
Emails contain the project name, a thread reference and links; never comment text, screenshots or reproduction
details. Opening a link still requires the recipient's normal authorized toolbar/app identity.
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
inbox delivery; this implementation does not process bounce/delivery-report events.

Provider references: [ACS repeatable requests](https://learn.microsoft.com/en-us/rest/api/communication/repeatable-requests)
and [email operation status](https://learn.microsoft.com/en-us/rest/api/communication/email/email/get-send-result?view=rest-communication-email-2025-09-01).

After correcting a delivery configuration error, run the workflow manually with `retry_delivery`
set to the id shown in the failure log. A confirmed failure gets another bounded retry cycle.
An ambiguous operation retains its original id and only reconciles with ACS; it never starts an
unrelated send. Check the provider's operation evidence before considering any manual data repair.

Unsubscribe/manage links are purpose-signed capabilities that cannot sign in or read comments.
GET is read-only; changes require a POST action. Member digests link to thread unsubscribe when
there is an explicit subscription, otherwise to project mute. Manage links expire after a year;
the toolbar/app always offers current controls. Changing a subscription invalidates older links.

Pending guest addresses expire after 24 hours. Verified subscriptions and preferences persist until
revoked; unsubscribe deletes the guest address. Event metadata and delivery evidence remain with
the project until removed, without duplicating comment content. Preview/local deployments follow
the existing no-mail model and expose verification links for testing; the scheduled worker runs
only against production.

## Validation

`notifications.api.spec.ts` exercises the production services with isolated local stores and a
controlled transport: owner and participant delivery, verification, batching, shared read-cursor
suppression, unsubscribe/mute, private/revoked access, provider failure, interrupted-send recovery
and duplicate/concurrent discovery. Browser coverage checks the optional guest flow, explicit
confirmation, member controls, light/dark UI and accessibility.
