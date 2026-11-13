# Screen recordings

A comment or reply can include one recording alongside its image evidence. The toolbar offers
**Record screen** where the browser supports screen capture and **Upload recording** for an
existing MP4 or WebM file, in the text box's Attach menu. The signed-in app offers the same controls on replies. Recording starts
only from the reviewer's action and the browser's source picker. Built-in capture requests video
without audio; uploaded videos can include their existing audio.
Video files are validated without re-encoding, so uploaded file metadata is preserved. A WebM screen
capture gets its length written into its header in the browser before preview and upload: browsers
record it without one, and a player then has no timeline to seek.

Capture is limited to 60 seconds and files to 25 MiB, with a maximum 4096 pixels per side. Stop
opens a local preview; discard removes the clip. A full document navigation or closing the review
ends capture. The capture adapter does not keep recording across navigation, request extension
tab-capture/offscreen permissions or record before the reviewer starts it. Browser capture depends
on HTTPS, browser/OS support and the reviewed site's `display-capture` permissions policy. Video
formats are selected with `MediaRecorder.isTypeSupported`; playback capability is handled by the
browser. There is no server transcoding or video redaction.

## Capture and send

`packages/toolbar/src/recordings.ts` shares the memory-only capture/upload state with app replies.
The composer shows the elapsed time and Stop/Discard controls. Recording blobs, browser object
URLs and upload credentials never enter local draft storage. The written message remains when
capture, upload or send fails. Send uploads the reviewed clip; previews and discarded clips do not
upload automatically. Reloading loses the unsent clip, while text follows the existing draft rules.

## API

The public API uses `/api/comments/recordings`, the embedded project toolbar uses
`/api/review/<projectId>/recordings`, and the signed-in app uses
`/api/projects/<projectId>/recordings`. The extension broker exposes only the corresponding closed
review operations and retains its normal document binding, verification and credential ownership.

1. `POST <base>` accepts `{ idempotencyKey?, contentType, size, duration?, width?, height? }` and
   returns `{ id, uploadUrl, headers, expiresAt }`. An optional stable idempotency key reuses the
   same actor/partition upload session and rejects different size or format. Browser duration and
   dimension hints are never trusted or saved.
2. `PUT uploadUrl` sends the raw file with the returned headers, without uier cookies, bearer,
   visitor or verification headers. The grant is scoped to one pending Blob object for ten minutes.
   A retry after a lost acknowledgement can complete an existing upload. An unfinished session can
   renew its expired grant using the same key for up to 24 hours from creation.
3. `POST <base>/<id>/complete` inspects actual bytes and returns
   `{ id, contentType, size, duration, width, height }`. Completion is idempotent. A completed clip
   can be attached for up to 24 hours from session creation.
4. Create-comment and reply payloads accept `recordingId`. The API requires the same partition and
   author that initialized the upload. Metadata, the upload's attached target, the comment/reply
   and its idempotency receipt commit in one conditional Cosmos transaction. One finalized upload
   cannot be attached to another message. A replay recovers the original comment after a lost response.

Each initialization reserves one of **10 uploads per actor per UTC day**, **100 per partition per
UTC day** and **100 per network bucket per UTC day**. Failed/discarded uploads do not refund the
reservation. At 25 MiB each, a partition's daily accepted upload reservations represent at most
2500 MiB of declared file data; Azure upload grants themselves do not enforce request length, so
completion rejects oversized objects and cleanup removes abandoned pending bytes.

## Validation and private storage

`apps/web/src/lib/recordings/service.ts` uses the server-only Mediabunny MP4/WebM demuxers with
buffer sources. It verifies actual video presence, dimensions, byte length and packet duration;
it does not follow media URLs or playlists. A ten-second inspection deadline and the 25 MiB input
bound limit parsing work. A 250 ms duration tolerance permits the encoder's final frame flush at
the 60-second capture limit. Invalid containers, missing video, mismatched MIME types and files
outside the limits cannot be attached.

`recordings/blobStore.ts` reuses the existing storage account, credentials and environment-specific
private screenshot container. Object names are
`recordings/<partition hash>/<recording id>/pending` and `/video`. The upload SAS writes only the
pending object. After inspection, the server writes the final bytes under an immutable final name;
the client's upload grant cannot change accepted evidence. Video bytes remain in Blob Storage;
Cosmos stores only upload state and small metadata. Upload records use `ttl: -1` until cleanup so
a failed delete or crashed finalize cannot erase the only cleanup pointer. Screenshot Blob sweeps
ignore these objects because recordings carry no screenshot ownership metadata.

Local development and browser/API tests without Cosmos use bounded in-memory storage and
`/api/recording-files/<id>?token=...` capability URLs. This route rejects deployments. It supports
range reads, expiry and the same separation between upload and playback capabilities.

## Playback and deletion

`GET .../comments/<id>/recording` and
`GET .../comments/<id>/replies/<itemId>/recording` recheck current comment access and live message
ownership before issuing `{ url, expiresAt }`. The app has equivalent cookie-protected project
routes. Signed HTTPS URLs are read-only, scoped to one final object and expire after 60 seconds.
Players request a fresh authorized URL when playback/seek needs it. Storage downloads carry no
uier credentials; responses specify `private, no-store`. URLs never enter stored comments, drafts,
feedback exports or integration ledgers. The same temporary bearer-link limits described in
[screenshot storage](screenshot-storage.md#direct-reads) apply.

Deleting a message, thread or project immediately makes its authorized recording route unavailable
and attempts to delete its final bytes. The upload record persists when Blob deletion fails, and
the worker retries it. Done and Archive retain recordings. A thread's TTL expiry removes access;
the scheduled worker subsequently removes its orphan bytes. Pending upload URLs can remain valid
until expiry, so their cleanup waits at least one hour after grant expiry. Unattached finalized
clips are retained for the 24-hour retry window. Both production and preview sweeps process one
bounded page of 100 session metadata records per tick and save their continuation separately.
Cleanup claims a record conditionally before erasing bytes, so a concurrent attachment transaction
either wins completely or fails without publishing a broken reference.

Videos are not automatically uploaded to integrations or sent to an AI service. Existing screenshots
and their integration/MCP behavior remain covered by their own contracts.

## Deployment and verification

CI applies the storage CORS update before deploying the website. It adds PUT and only the required
upload headers to the existing private service policy, without changing containers, keys, RBAC,
anonymous access, versioning, soft deletion or resource protection. Do not run `pulumi up` locally.
The app and installation guide include the configured Blob origin for upload connections and
video playback; local previews also need `media-src blob:`. Existing strict embeds must update
their CSP before their reviewers use recordings.

`e2e/recordings.api.spec.ts` exercises real Chromium-encoded fixtures, malformed/overlong input,
actor and partition isolation, immutable evidence, receipt recovery, quotas, seeking and cleanup.
`e2e/recordings.spec.ts` and `recording-app.spec.ts` cover capture/upload, local preview, cancellation,
retry, playback and mobile fallback. These tests establish local behavior, not Azure IAM/CORS or
physical screen-picker acceptance. After CI deployment, verify direct uploads and private playback
on production and preview independently, permission revocation, refreshed seeking URLs, full-page
navigation cancellation, deletion and a scheduled orphan sweep. Record native browser/OS screen
capture acceptance separately from mocked capture in browser tests.
