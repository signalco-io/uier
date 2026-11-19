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
| `onRequestTarget?: () => void` | Switch version if needed and enter location selection. Return the selection in `draftAnchor`. While selecting, give the location picker priority over pin buttons so it can capture overlapping points. |
| `onThreadsChange?: (threads: ProofThread[]) => void` | Render the current page's authorized pins using their stable thread id, number and location. |

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
| POST | `/threads` | `{text, authorName?, idempotencyKey, location, private?}` → `{thread}`. A guest supplies their name. An admin can choose a private thread. |
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
receipts, assignees, status, history and activity. Locations refer to a published
version's manifest. Points, regions and drawings use normalized surface coordinates.
Text captures the quoted string on that surface. Media times are integer milliseconds.
General feedback addresses the entire version. The server validates the surface,
region bounds and time range and caps the serialized relocation data.

Requests copy the exact source and a location on a newer published version of the same
file into `DbVerification.evidence`. Relocating a pin or publishing another version
cannot change that request. The proof viewer opens the request location when a link
names that version. It resolves scoped preview and viewer URLs from the version on
read. A successful action advances to the next pending check on that version and
focuses the new thread heading. A conflict reloads the current request or decision.
An exact retry can return the saved action while that request is current. A stale
retry on a superseded request returns a conflict.

Website queries, badges, realtime, direct-ID reads and writes, and legacy exports
require website targets. The file authorization scope works in the other direction
too. A file-only session cannot act on a website thread. Existing integration sync
excludes proof threads, and private exports use the same asset and thread checks as
viewer reads. My work links authorized member activity to the source version and
pending checks to the version under review. Website-view guests receive no proof
data. The guest proof session identifies the original reviewer without including
their identity or share reference in DTOs. Revoked grants are rechecked for every
conditional action and receipt replay.

`proof-threads.api.spec.ts` covers memory-backed route handling and the Cosmos
query contract. The browser suite covers the viewer mount separately.
