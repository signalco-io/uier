# File proof API

The member library lives at `/app/projects/[projectId]/files`. The viewer uses
`/proof/[projectId]/[assetId]`. Add `?version=<id>` for immutable evidence.
Collections use `/proof/[projectId]/collection/[collectionId]`. The project
parameter accepts the public review ID or an eligible existing review code.
Members may also use the internal project ID. Asset and version IDs stay stable.

All paths below are relative to `/api/proofs/[projectId]`. Use a same-origin
app session or an exchanged proof cookie. JSON errors use the existing API error
shape. The browser-safe contracts and URL builders are in
[`model.ts`](../src/lib/proofs/model.ts).

| Method | Path | Input and response |
| --- | --- | --- |
| GET | `/` | `ProofLibrary`. Guests see only their asset or collection. |
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

Read `share` from the link's fragment and POST it to the exchange endpoint.
Remove the fragment after using it. A browser holds one active share scope per
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
