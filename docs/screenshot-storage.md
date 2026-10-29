# Screenshot storage

New screenshots and replacement images keep their sanitized binary bytes in private Azure Blob
Storage (Standard LRS, Hot, West Europe). Cosmos DB keeps the comment metadata and a small
`type: 'screenshot'` reference document in its existing partition. No CDN is configured.
Local development and browser tests retain the in-memory store unless Cosmos is configured.

## Access and deployment configuration

`infra/src/screenshots.ts` provisions one protected storage account, private `screenshots` and
`screenshots-preview` containers, read-only GET/HEAD CORS and the Vercel variables below.
Anonymous Blob access, versioning and soft deletion are disabled. Redaction/deletion must not
leave recoverable old versions. There is no Blob backup/restore promise; a Cosmos restore alone
cannot restore image bytes. See [backups](backups-and-restore.md).

| Variable | Production | Preview |
| --- | --- | --- |
| `AZURE_SCREENSHOTS_ENDPOINT` | Account Blob endpoint | Same endpoint |
| `AZURE_SCREENSHOTS_CONTAINER` | `screenshots` | `screenshots-preview` |
| `AZURE_SCREENSHOTS_CONNECTION_STRING` | Server-only encrypted key, retrievable by the scheduled worker | Absent |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` | Existing configuration unchanged | Existing preview OIDC identity |

Preview gets Blob Data Contributor only on its container and Blob Delegator on the account.
Delegation can sign only the intersection of its data permissions and the SAS permissions, so
it cannot grant access to production images. No production storage key goes to previews.
The production worker can migrate and sweep both environments with its production credentials.
Never print pulled environment files, account keys or signed URLs.

**Deployment prerequisite:** the existing deployment principal's resource-group Contributor
role excludes `Microsoft.Authorization/roleAssignments/write`. An owner must arrange permission
for the two new storage role assignments before this PR merges. Scope that permission to these
roles and the existing preview principal, or have the owner create/import these exact assignments.
Do not broaden CI permissions automatically or run `pulumi up` locally. Review CI's Pulumi preview
for additions only: the storage account, Blob service settings, two containers, two assignments
and four Vercel variables. Existing Cosmos, identities, email, DNS and backup settings stay untouched.

## Direct reads

The toolbar requests `GET .../comments/<id>/screenshot` with
`Accept: application/vnd.uier.screenshot-url+json`. After normal current comment/project/actor
permission checks, a Blob reference yields `{ url, expiresAt }`. The URL is HTTPS-only, read-only,
scoped to one immutable blob and valid for 60 seconds. The toolbar downloads it in a separate
request with no cookies, review/visitor headers or referrer, then displays a browser-memory data URL.
Do not redirect requests carrying reviewer headers to Azure. Older clients and existing inline
Cosmos images continue to receive image bytes from the API. New clients also fall back to that
response if an existing embed CSP blocks the direct download. The signed-in app's cookie-protected
image route redirects to Blob Storage. Both responses and Blob responses specify no-store.

A signed URL is a temporary bearer credential: someone who obtains it can read that image until
expiry, including for up to 60 seconds after a permission change. Successful image deletion removes
the blob itself. Signed URLs are never persisted in comments, feedback packets, integration ledgers
or MCP resources. MCP and connected services fetch bytes server-side after their existing permission
checks. Third-party uploads keep their own retention rules.

The app's CSP and the project's install guide add the exact configured Blob origin. Existing
embeds with a restrictive `connect-src` must add that origin from the updated install guide.
No wildcard Blob origin is added to the app's CSP.

## Writes, migration and cleanup

1. Validate and re-encode the uploaded/captured pixels on the server with the existing limits.
2. Upload raw bytes under a new, immutable name. Names contain a hash of the partition, the
   comment id and a random revision; Blob metadata retains the partition/comment ids for cleanup.
3. Atomically commit only the small image reference and comment/receipt in Cosmos. Concurrent
   changes still use the authorized comment etag. An uncertain transaction never triggers immediate
   deletion of the proposed image: the transaction may have committed.
4. After a confirmed replacement, delete the old blob. Failed deletes and uploads left by failed
   transactions are retried by the scheduled sweep once the blob is more than an hour old. The
   sweep checks both the live comment and the exact current image reference and deletes the
   observed Blob etag. This also handles Cosmos TTL expiry and deleted reference documents. Blob
   scans process one page of at most 100 images per tick, persist their cursor in Cosmos and
   wait an hour after a complete pass. Live Blob references are excluded from the legacy Cosmos
   orphan query so two independent sweeps do not repeatedly read the same live image metadata.

The existing five-minute notification worker migrates at most 20 inline images per environment
per run. Upload succeeds before an etag-conditional replacement removes the base64 field. The
migration preserves image revision, dimensions and remaining per-item/container TTL; a concurrent
replacement wins without losing pixels. Old images stay readable throughout. A failed migration
keeps its original inline data and is retried. Failed sweeps mark the workflow failed for follow-up.
The preview sweep runs even though previews do not have their own scheduled notification worker.

## Rollout verification

Local tests use a fake Blob store/SDK surface, transaction fixtures and intercepted browser reads;
they do not establish Azure IAM, CORS, signing or migrated production data acceptance.

Before merge, review the CI preview and arrange the role-assignment prerequisite above. After the
CI deployment, verify new public and private images, direct downloads in the toolbar and app,
preview isolation, authorized server-side MCP/integration reads, replacement/redaction, stale
replacement rejection and deletion. Confirm no-store, one-blob read-only SAS and expiry. For an
existing embed, update its CSP sources and repeat the browser check. Watch the scheduled worker,
record migrated/failed counts and independently query for remaining inline `data` fields in both
Cosmos containers. Inspect Blob orphans after the one-hour grace period. Do not claim the live
migration complete from a code merge or a passing local fixture.

Rollback must retain Blob reads and credentials once references have been written. Reverting to a
version that understands only inline `data` breaks saved images. Keep the storage resources
protected and use a forward fix; do not remove the new containers or restore erased pixels.
