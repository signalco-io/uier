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
| GET, PATCH | `/settings` | GET returns `{formats, canEdit, htmlAvailable}`. Admins can PATCH `{formats}`. |
| POST | `/figma/frames` | `{url, token}` → `{name, frames}`. Member-only discovery using the member's Figma personal access token. |
| POST | `/assets/:assetId/figma` | `{url, token, frameIds, requestId, expectedVersionId}` → `{version}`. Member-only snapshot import or resync. |
| GET, POST, DELETE | `/assets/:assetId/email-address` | Member-only state, rotation or disable. POST returns the address once. |
| GET | `/assets/:assetId/versions/:versionId/prototype` | `?surface=<id>` optionally opens another page. Returns a 30-minute bundle URL and expiry. |

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
`['image']`. Pausing a format leaves published versions readable. The Files page's **File formats** setting lets admins change this list. All
sources use the 20 MiB upload cap. An HTML upload also requires a configured
isolated preview host. Supported input and preview contracts follow.

| Source | Published evidence and limits |
| --- | --- |
| PNG, JPEG, WebP, GIF, SVG | Pixel-decoded WebP without source metadata. Static files are oriented. GIF and animated WebP preserve frame timing. SVG is limited to 2 MiB and references within the document, then rasterized. All images are bounded by decoded pixel and frame limits. |
| PDF | Up to 100 pages and a bounded rendering job. The authorized browser PDF and JSON text evidence are generated from rendered page pixels and local OCR. Stable page signatures support matching unique text or scanned pixels across reorders. Repeated signatures remain ambiguous. |
| Figma Design | Choose up to 20 frames using a personal access token with `file_content:read`. Snapshots pin the Figma file revision used during export. Resync reports added, renamed and removed frames. Source links and selection metadata are member-only. |
| MP4, MOV, WebM | AVC/AAC MP4 or MOV and VP8/VP9 with Opus/Vorbis WebM are remuxed. Other supported codecs and rotated movies require the bounded FFmpeg processor, which outputs AVC/AAC MP4 with a JPEG poster. Sources may be up to 15 minutes and 4K. Conversion is limited to two minutes of input and at most 1080p/60 fps output. |
| EML or test email | MIME-parsed subject, preheader, sender, link destinations, text and sanitized HTML. HTML bytes are fetched as inert plain text on the app origin. The viewer uses an opaque iframe with tracking requests, active content and link navigation disabled. Embedded image previews are capped and re-encoded. |
| HTML or ZIP | UTF-8 single HTML, or a directory packaged as ZIP in the Files dialog. The archive may contain up to 100 entries and 32 MiB expanded. Use `index.html` at the root. ZIP paths, types, compression and duplicate entries are validated without extracting files to disk. |

The browser sends the file with a credential-free PUT and the returned
headers. The upload grant can only create one staging object for ten minutes.
To renew an expired grant while the slot is open, repeat the original upload
request for up to 24 hours. The same request ID with different metadata
conflicts. Slots with staged bytes and slots that have already finished return
`uploadUrl: null` on a repeat. A finalize retry never creates a second
version. A temporary processing conflict can be retried on the same slot.

Server adapters register `ProofSourceAdapter` in
[`sources.ts`](../src/lib/proofs/sources.ts). Its `ingest({bytes, filename,
contentType, signal})` returns `{manifest, artifacts, resources?}`, with entries
`{id, contentType, bytes}`. The service validates output names, types and
sizes, and checks the source and current version before publishing. An
adapter can throw `ProofSourceError` for a terminal input error. A transient
failure leaves a processing job for the next request or worker run.
Server imports use `beginAuthorizedProofUpload`, `stageAuthorizedProofSource`
and `finalizeAuthorizedProofUpload` with live authorization. Figma snapshots
cannot be published through ordinary grants. The source token is used for
each discovery or resync and kept out of storage and preview URLs. Inaccessible
sources, a failed export or a stale version leave the current review available.

### PDF display privacy

PDF previews contain an independently constructed PDF and a bounded JSON
text artifact. The processor renders each page with annotations disabled,
then runs a bundled English OCR model over those pixels. The output PDF has
positioned invisible OCR words so the browser can search and select text.
The original document's attachments, form fields, action dictionaries,
metadata and source text layer are absent from both previews. The media
route requires the `raster-ocr-v1` marker before serving PDF derivatives.
OCR may introduce recognition errors and has limited coverage of scripts
outside its model. Graphics are rasterized. The authorized original endpoint
returns the exact uploaded bytes.

### Isolated prototype playback

The app grants access to an immutable bundle at the configured preview host.
The resource handler ignores cookies and checks the signed scope, expiry,
project epoch and live membership or share on every request. The host serves
prototype routes only. The app host denies prototype resource paths. Both the
iframe and the response sandbox run documents as opaque origins. The policy
allows scripts, local images, CSS, fonts and JSON under the same bundle URL.
Relative resource paths work, and root HTML attribute paths are rewritten
within the bundle. Runtime requests should use relative URLs. The bridge
supports point or text evidence for bundled pages. Arbitrary application
state and captured screenshots are outside the current preview contract.
Reload the review if an open prototype has outlived its URL.

### Inbound test messages and agents

The dedicated mail worker POSTs raw `message/rfc822` to `/api/proof-mail`
with its bearer and the complete SMTP envelope recipient in `X-Uier-Envelope-To`.
The configured literal alias accepts a random plus detail that contains no
project or asset identifiers. The server looks up its hash and ignores MIME
recipients for routing. It accepts up to 4 MiB. Rotating or disabling the address invalidates
intake immediately. The project epoch and address owner's membership are
rechecked before publishing. The combination of address generation and
Message-ID deduplicates retries across versions. Transport-only headers
are excluded from the content check. The exact source stays in its original
attachment. Uploading an EML file needs only the email format setting.

A coding connection with `proofs:upload` can list its permitted files,
begin a scoped staged upload and finalize a version. Agent tools use the
same format policy and version concurrency checks as the library. Preview
links require the viewer's own permission. See the [MCP contract](../../../docs/mcp.md).

Hosted setup and preview qualification are in the [proof provider runbook](../../../docs/proof-providers.md).

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
