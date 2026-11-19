# Proof threads and fix verification

## Viewer mount

Mount the named `ProofThreads` client component from
`src/components/app/proofs/ProofThreads.tsx` inside the viewer's thread panel. Pass
`projectId` (the public route identifier), `assetId`, `versionId` (the version on screen),
and `currentVersionId` (the latest published version). Keep the panel mounted while
switching versions. Its optional props connect the renderer and the thread panel:

| Prop | Viewer responsibility |
| --- | --- |
| `threadId?: string` | Selected thread, including the initial `thread` query parameter. |
| `draftAnchor?: ProofAnchor` | Location selected on the version on screen. Clear it when changing version unless the renderer explicitly restores it. |
| `onThreadSelect?: (threadId: string) => void` | Update the selected pin and `thread` query key. |
| `onJump?: (location: ProofThreadLocation) => void` | Open the given `versionId` and align its `anchor` in the rendered page, frame or time range. |
| `onEvidence?: (evidence: ProofVerificationEvidence, side: 'before' \| 'after') => void` | Show or compare the two saved locations. Without this callback the panel calls `onJump` with the selected side. |
| `onRequestTarget?: (location: ProofThreadLocation) => void` | Switch version if needed and enter location selection. Return the selection in `draftAnchor`. While selecting, give the location picker priority over pin buttons so it can capture overlapping points. |
| `onThreadsChange?: (threads: ProofThread[]) => void` | Render the current page's authorized pins using their stable thread id, number and location. |
| `copySuggestions?: boolean` | Offer a replacement for a selected PDF or email quote. |

`ProofThreadLocation` is `{ versionId, anchor }`. `ProofVerificationEvidence` is
`{ assetId, before: ProofThreadLocation, after: ProofThreadLocation }`.
The component uses same-origin fetches with the viewer's existing proof session. Keep
share credentials out of thread links and props. Public permalinks use
`/proof/[projectId]/[assetId]?version=…&thread=…`.

A thread's source location is immutable. A member can save an explicit correspondence
under another version. Starting a verification request copies the original and selected
fixed location into the request. The saved evidence is independent of any later
relocation, published version or renderer state.

## Routes and stored records

The [asset API](proof-api.md) authorizes the project and active share before the
thread service resolves any IDs. All endpoints below start with
`/api/proofs/[projectId]/assets/[assetId]`. Responses use private, no-store caching.
Writes require same-origin JSON.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/threads?version=…` | `ProofThreadPage`, including the authorized threads and available statuses. |
| POST | `/threads` | `{text, authorName?, idempotencyKey, location, private?, suggestion?}` → `{thread}`. A guest supplies their name. An admin can choose a private thread. |
| GET | `/threads/:id?version=…` | `{thread}` independently of list paging. The original location is returned as a fallback when the selected version has no correspondence. |
| PATCH | `/threads/:id?version=…` | `operation` is `status` with `statusId`, `archive` with `archived`, `assignment` with `assigneeIds`, `private` with a boolean `private`, `read` with the shown `sequence`, or `relocate` with `location` and `expectedRevision`. Status, archive and assignment take an `idempotencyKey`. Read returns `{activity}`. Other mutations return `{thread}`. |
| POST | `/threads/:id/replies?version=…` | `{text, authorName?, idempotencyKey}` → `{thread}`. |
| POST | `/threads/:id/verification` | Existing request/confirm/reject/cancel input. Request requires `evidence`. Decisions and cancel require the request's `targetVersionId`. Every action takes `expectedRevision` and `idempotencyKey`. |
| GET | `/verification?version=…` | `ProofPendingPage`, including exact `count` for the current reviewer and requested version. Explicit `scope=asset` lets the reviewer resume a check on another version of the same asset. |
| GET | `/threads/:id/export` | The usual feedback export with the proof's source, version locations and verification decision. Links omit share credentials and require live authorization when opened. |

Lists accept `limit` and opaque `before` keyset cursors returned as `next`.
The selected version defaults to the published version. Scope and privacy apply
before every page limit. Counts use the same predicate before the cursor.
Pages are live, so a new decision can remove a pending row between reads.
Project opt-in controls the queue, decisions and request reminders.

`DbComment.assetTarget` is optional and shares the project's thread numbering,
receipts, assignees, workflow status, history and activity. Archived threads retain their
workflow `statusId` and show the archive state separately. An explicit archive/restore control
uses the existing `archive` operation. Locations refer to a published
version's manifest. Points, regions and drawings use normalized surface coordinates.
Text captures the quoted string with an optional occurrence and an optional
email field. PDF and email quote threads can carry an immutable
`suggestion: { replacement }` of up to 1,000 characters. Media times are integer
milliseconds with optional normalized point or region geometry. A prototype
anchor contains a bounded element path and inert, version-bound evidence. General
feedback addresses the entire version. The server validates format-specific
anchors, surface membership, geometry and time ranges and caps serialized
relocation data.

Requests copy the exact source and a location on a newer published version of the same
file into `DbVerification.evidence`. Relocating a pin or publishing another version
cannot change that request. The proof viewer opens the request location when a link
names that version. It resolves scoped preview and viewer URLs from the version on
read. A successful action advances to the next pending check on that version and
focuses the new thread heading. A conflict reloads the current request or decision.
An exact retry can return the saved action while that request is current. A stale
retry on a superseded request returns a conflict.

Website queries, badges, realtime, direct-ID reads and writes, and legacy exports
require website targets. File sessions check the owning asset on reads and writes.
The browser export applies the same authorization as the viewer and uses a stable
original link plus a revision link when the selected revision has a saved location.
The [MCP handoff](mcp-connector.md#file-proof-handoff) and
[tracker sync](integrations.md#synchronization) use redacted packets.
My work links authorized member activity to the source version and
pending checks to the version under review. Website-view guests receive no proof
data. The guest proof session identifies the original reviewer without including
their identity or share reference in DTOs. Revoked grants are rechecked for every
conditional action and receipt replay.

`proof-threads.api.spec.ts` covers memory-backed route handling and the Cosmos
query contract. The browser suite covers the viewer mount separately.

## Returning guest review

The author of a file thread can choose **Follow thread** and verify their email
from the confirmation link. Creating or replying to a thread leaves subscriptions
unchanged. A member opens the usual proof permalink through their app session.
A guest using the original browser and share can continue to check fixes without email.

On another device, the guest can open a notification or use **Recover guest review**
on the asset page. Recovery always acknowledges the request the same way. It sends
a link only for a live, verified subscription on that file. Opening the emailed
page shows a confirmation control. The credential stays in the fragment until the
page reads it and is submitted only when the guest continues. A confirmation
link is usable once within 24 hours. Recovery links last 30 minutes. Notification
links last seven days, and fix reminders also match the exact pending request and
its target version.

The resulting HttpOnly session lasts up to 30 days, bounded by the original
share's expiry. It can view that file's published review and resume threads
authored by the same guest under that share. It carries no original-download,
collection, website, posting or version-approval grants. The queue's page and
exact count both apply the author, asset, share and version restrictions.
Unfollowing removes the mailbox binding and invalidates copies of that link
and sessions based on it. An independent subscription can still be recovered.
Reads, decisions, receipt replays and delivery recheck the live grant, file,
project policy and transfer epoch.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/threads/:id/notifications` | The original guest's `{following, pending}` state. |
| POST | `/threads/:id/notifications` | `{following, email?}` requests confirmation or unfollows. |
| POST | `/returning` | `{action: 'recover', email}` acknowledges with HTTP 204. `{action: 'open', token}` exchanges the emailed credential for a cookie and returns the exact `{href}`. |

See [the proof API spec](../e2e/proof-threads.api.spec.ts) for digest, recovery,
exact counts, scope, expiration, unsubscribe, revocation and transfer checks.
The [verification browser spec](../e2e/proof-verification.spec.ts) exercises
confirmation and fix review on desktop and mobile with independent browser contexts.

## Design to staging

Pairings store the exact project, approval decisions, asset, version, surface,
authorized page and CSS viewport. Members use `/api/proofs/[projectId]/staging`
to list/create pairs for a surface, and `/staging/:pairingId` to revoke a pair they
created or administer. Member-only link routes open the checked staging target
(`/staging/:pairingId/open`), the immutable surface (`/staging/:pairingId/design`
or `/staging/thread/:commentId`), or a paged list of visible linked threads
(`/staging/:pairingId/threads`). The toolbar and extension can resolve only the
paired viewport for their current authorized origin and page. They submit the
pairing ID with the regular comment POST. The server writes the exact design
reference into the normal website comment. Website guests can still see the
comment under its ordinary visibility rules.

The comparison embeds a small app-origin document. Its framing policy allows
only the paired origin. First-party app or app review sign-in authorizes the
image, independently of the staging toolbar's token. A browser that blocks
third-party cookies can authorize the frame from a first-party tab. The frame
keeps its verifier private and the server stores a 15-minute access receipt.
Preview requests return private bytes with no shared caching or CORS. The frame
rechecks current authority every 30 seconds and on return to the tab. A certified
PDF serves the selected page's raster from its published rendition. The approved
raster stays out of the toolbar's screenshots and recordings.

Publishing a new version, pausing, or closing a round keeps its historical
approved decisions. Replacing a required decision, revoking the pair, removing
its authorized address, or retiring the asset/project invalidates new staging
reads and writes. Project transfer retires its old pairing and preview grants.
The ordinary website thread and historical screenshots still follow their
existing permissions. Deleting a proof or a project cleans up its pairing
records and preview grants.
