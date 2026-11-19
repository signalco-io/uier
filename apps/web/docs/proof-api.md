# File proof API

The member library lives at `/app/projects/[projectId]/files`. The viewer uses
`/proof/[projectId]/[assetId]`. Add `?version=<id>` for immutable evidence.
Collections use `/proof/[projectId]/collection/[collectionId]`. The project
parameter accepts the public review ID or an eligible existing review code.
Regular projects' internal IDs are valid legacy review codes. Asset and version IDs stay stable.

All paths below are relative to `/api/proofs/[projectId]`. Use a same-origin
app session or an exchanged proof cookie. JSON errors use the existing API error
shape. The browser-safe contracts and URL builders are in
[`model.ts`](../src/lib/proofs/model.ts).

| Method | Path | Input and response |
| --- | --- | --- |
| GET | `/` | `ProofLibrary`. Guests see only their asset or collection. Optional `?collection=<id>` filters the library. |
| POST | `/assets` | `{name, collectionId?, position?}` → `{asset}` |
| GET | `/assets/:assetId` | `?version=<id>` optional. Returns `ProofAssetDetail`. |
| PATCH | `/assets/:assetId` | `{name?, collectionId?, position?}` → `{asset}`. Use null to remove from a collection. |
| DELETE | `/assets/:assetId` | 204 |
| POST | `/collections` | `{name, position?}` → `{collection}` |
| PATCH | `/collections/:id` | `{name?, position?}` → `{collection}` |
| DELETE | `/collections/:id` | 204. A collection must be empty. |
| POST | `/assets/:assetId/uploads` | `ProofUploadInput` → `ProofUploadGrant`. PUT file to `uploadUrl` with returned headers. |
| POST | `/assets/:assetId/uploads/:versionId/finalize` | No body → `{version}`. Retry using the same version. |
| GET | `/assets/:assetId/versions/:versionId/media/:artifactId` | Inline authorized preview. |
| GET | `/assets/:assetId/versions/:versionId/original` | Authorized attachment download. |
| GET | `/shares` | `{shares}` for members. |
| POST | `/shares` | `{scope, permission, downloadOriginal?, expiresAt?}` → `{share, url}`. |
| DELETE | `/shares/:shareId` | 204 and revokes exchanged sessions. |
| POST | `/exchange` | `{token}` → `{scope}` and an HttpOnly proof session. |
| GET, PATCH | `/settings` | `{formats}`. An admin can set the enabled upload formats. |

Read `share` from the link's fragment and POST it to the exchange endpoint.
Remove the fragment after using it. The server stores only a hash of the link credential. A browser holds one active share scope per
project. Member sessions keep their member permissions. Acquire a fresh
`requestId` (for example `crypto.randomUUID()`) per upload. A new upload uses
the asset's `currentVersionId` as `expectedVersionId`, or null for its first
version. A publish racing a newer published version receives 409.

The review service imports
`authorizeProof(request, {projectId, assetId?, versionId?}, capability?)`
from `src/lib/proofs/access.ts`. Capability is `view`, `comment`,
`downloadOriginal` or `manage`, defaulting to `view`. Returns
`{project, actor, asset, version}`. Pass an explicit immutable version for
thread mutations and verification evidence. Recheck authorization whenever
retrying a conditional write or serving an earlier receipt. For a guest, only
a live share session can establish their `visitorId`. See `project.id` for
the internal ID and `actor.scope` for the authorization boundary.

## Format settings and processing

Members can read `GET /settings` for `{formats}`. A workspace admin can
`PATCH /settings` with the same shape. New upload grants and publishing
check both this setting and the registered source adapter. The default is
`['image']`. Pausing a format leaves published versions readable. The current
image adapter decodes PNG, JPEG, WebP and GIF, validates the declared format,
and publishes an oriented, metadata-free WebP preview. It caps sources at
20 MiB and limits decoded pixels and frames. SVG requires its own safe adapter.

The browser sends the file with a credential-free PUT and the returned
headers. The upload grant can only create one staging object for ten minutes.
To renew an expired grant while the slot is open, repeat the original upload
request for up to 24 hours. The same request ID with different metadata
conflicts. Slots with staged bytes and slots that have already finished return
`uploadUrl: null` on a repeat. A finalize retry never creates a second
version. A temporary processing conflict can be retried on the same slot.

Server adapters register `ProofSourceAdapter` in
[`sources.ts`](../src/lib/proofs/sources.ts). Its `ingest({bytes, filename,
contentType, signal})` returns `{manifest, artifacts}`, with entries
`{id, contentType, bytes}`. The service validates output names, types and
sizes, and checks the source and current version before publishing. An
adapter can throw `ProofSourceError` for a terminal input error. A transient
failure leaves a processing job for the next request or worker run.
An authenticated server import calls `beginProofUpload(request, projectId,
assetId, input)`, `stageProofSource(request, projectId, assetId, versionId,
bytes)`, then `finalizeProofUpload(request, projectId, assetId, versionId)`.
The imports use the same member, format, upload and publish checks.

## Access and storage maintenance

Workspace membership and project access are checked on every request.
Guest exchanges require the project's `guests` setting, a live share and its
scope. An asset share includes that asset's published history. A collection
share follows current collection membership and includes published history
for its member files. Guests see only published versions. With project
comments disabled, members retain file reads and management and lose the
comment capability. Whole-version decisions use the named approval authority
described below.

Preview and attachment URLs are same-origin API paths that reauthorize each
request or byte range. Responses are private and uncacheable. No Blob read
grant is sent to the client. An authorized response may finish streaming
after revocation. Clients can retain copies of bytes they already received.
Original downloads require the explicit share permission and are served as
attachments.

Proof metadata uses typed records in the `proof:<internalProjectId>`
partition of the existing Cosmos app container. The comments container
continues to contain the canonical threads and existing comment record types.
Originals and derivatives use the existing private Azure Blob containers
under `proofs/`, isolated by environment. The publish transaction updates
the version and current pointer together. Each processing attempt writes
to its own create-only keys. Hosted upload grants use the existing storage
account's CORS and credentials. Local development uses the app's in-memory
metadata adapter and a private in-memory blob store.

The production worker retries interrupted ingestions, reclaims stage and
failed-attempt blobs after grant and processing expiry, and prunes deleted
assets. Project deletion retires access and keeps its durable cleanup intent
until bytes and records are gone. Transfer keeps published evidence with the
stable project ID, retires guest links and stages, and uses the destination's
live membership afterward. Preview deployments use their own configured
Cosmos and Blob clients. The production maintenance identity has no access to
preview proof metadata. Run cleanup or retry verification using a preview
runtime and its own identity.

[`proof-assets.api.spec.ts`](../e2e/proof-assets.api.spec.ts) exercises the
same handlers and workers with memory storage or configured disposable Cosmos
and Azure Blob emulators. The local API fixtures cover scoped grants, format
policy, racing publishers, retry, transfer and removal of private bytes.
[Source tests](../e2e/proof-sources.api.spec.ts) exercise adapter publication,
PDF privacy and evidence, provider access and replay, source rotation,
prototype fencing and agent permissions. [Browser imports](../e2e/proof-imports.spec.ts)
cover guest PDF page search and directory selection with an isolated host.


## Version approvals and review record

Open **Approvals** in the file viewer to see the selected version's decisions
or start and manage its round. The file library and collection review summarize
the current version, its deadline and outstanding reviewers. Historical versions
remain available using the version selector or an immutable permalink.

| Method | Path | Input and response |
| --- | --- | --- |
| GET | `/approvals?collection=<id>` | Current summaries keyed by the assets visible within the current scope. The collection filter is optional. |
| GET | `/assets/:assetId/approvals?version=<id>` | `ApprovalReview`. Defaults to the current published version. |
| GET | `/assets/:assetId/approvals?version=<id>&mode=options` | Management-only member, live share and assignment options for the selected file. |
| POST | `/assets/:assetId/approvals` | `{versionId, requestId, reviewers, deadline}` starts the round. |
| PATCH | `/assets/:assetId/approvals` | `{versionId, requestId, revision, state, deadline, reviewers?}` edits, pauses, resumes or closes the current round. |
| POST | `/assets/:assetId/approvals?mode=decision` | `{versionId, requestId, revision, decisionRevision, decision, explanation?}` records or revises the caller's own decision. |
| POST | `/assets/:assetId/approvals?mode=recover` | `{versionId, email}` queues an email if the guest's current grant is assigned to that mailbox. Always returns 204 for authorized guests. |
| POST | `/approvals` | `{token}` exchanges the emailed one-time fragment for a verified review session and its assigned proof share. |
| GET | `/assets/:assetId/approvals?version=<id>&mode=export` | JSON attachment with version and digest, reviewer decisions and history, and visible proof discussion. |

Each reviewer is `{kind: 'member', userId, required}` or
`{kind: 'external', name, email, shareId, required}`. The roster can contain
up to 20 reviewers and requires at least one required reviewer. An optional
reviewer can leave a decision without affecting the required sign-off result.
All required reviewers must independently approve. A required change request
sets the outcome to **Changes requested** and requires an explanation. Thread
resolution and fix verification are independent of version approval.

Set `deadline` to an ISO timestamp or null. An open overdue round continues
to receive decisions. Pausing stops decisions and defers email. Closing keeps
the recorded evidence and ends the round. A new published version carries
forward the prior roster, starts with fresh decisions, and has no deadline
until one is set. A paused round carries its pause to the new version. Changes
check the round revision and decisions also check the caller's own decision
revision, starting at zero. An authorized retry using the same request ID and
input returns the live view without creating another event. Superseded versions
keep their evidence and accept only authorized retries of recorded submissions.

External approvals need a verified mailbox identity and the exact assigned,
live asset or collection share. The ordinary view or comment link does not
verify the reviewer. Invitations and recovery links are one-time and expire
within seven days or when the assigned share expires. They stay in the URL
fragment until exchanged. Project members use their authenticated account and
current project access. A project transfer retires earlier approval authority
and invitations, retains historical decisions, and permits new rounds on new
versions. Asset and project deletion remove approval records.

The existing notification worker delivers invitations and, for reviewers still
awaiting a decision, reminders one day before the deadline and at the deadline.
An approaching reminder is scheduled for deadlines more than a day away.
Receipts and the existing email provider's operation identity make retries
idempotent. Delivery rechecks current file and reviewer access, row revision,
pause/close state, and email suppression. Member notification mutes also apply.

Review records use the selected version's comment scope. Member exports apply
the standard thread-visibility rules. Guest exports omit all private threads.
Exports omit mailbox addresses, share credentials and server-only message
metadata for both audiences. The original download URL is available only
to readers with original-download authority. It reauthorizes on use.

[`proof-approvals.api.spec.ts`](../e2e/proof-approvals.api.spec.ts) covers the
authorization, persistence, mail worker and export boundaries.
[`proof-approvals.spec.ts`](../e2e/proof-approvals.spec.ts) drives the browser
flow on desktop and mobile.
