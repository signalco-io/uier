# Screen recordings

New comments, feedback, rewrites and replies can include one short recording alongside their image.
`src/recordings.ts` is the UI-independent browser hook and upload helper, exported as
`@uier/toolbar/recordings` for the signed-in app. `ComposerAttachMenu.tsx` offers Record screen and Upload
recording, `ComposerRecording.tsx` shows the capture and the clip;
`CommentRecording.tsx` plays saved evidence.

## Capture and attach

- **Record screen** uses `getDisplayMedia` and `MediaRecorder` directly from a button press. It requests
  video only; the browser chooses and authorizes the tab, window or screen each time. The control shows
  only when the browser exposes capture in a secure context.
- **Upload recording** is available independently of capture. MP4 and WebM files must be at most
  25 MiB and 60 seconds. The browser checks file metadata before attaching; the server independently
  inspects the actual container before publishing it.
- Record screen and Upload recording are items of **Attach**'s menu, with Attach image, in the text box's
  bottom row ([uier #391](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_napwWAvckuKEmZr-J0GGQ)). A running capture and an attached clip take them out of the menu
  and show above the text, inside the box, each with its own controls; the bottom row never holds a second
  Discard next to the draft's.
- While recording, that bar shows the elapsed time against the limit (`0:07 / 1:00`), a labelled Stop
  (focused as it appears) and Discard, with a line under it that parts it from the text. No note is shown
  under it; that leaving the page ends the capture is in Record screen's description ([uier #392](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_YXnTpkhHn_yaM5NkbiPdO)). Outside
  interaction keeps the non-modal composer open, so the reviewer can reproduce a problem on the page and
  still stop. Starting from an expanded modal first collapses it. Escape stops recording and retains its preview.
- A stopped or uploaded recording has a native video preview before Send, captioned with its name, its
  length and Discard. The screenshot's existing no-preview composer rule is unchanged. Text is still
  required. An active capture or file read holds Send.
- `MediaRecorder` writes WebM as a live stream with no length, so a player shows none and cannot seek.
  `withWebmDuration` adds the Duration element to a finished capture's header before it is previewed or
  uploaded. It only touches the layout browsers record (an unsized Segment whose Info has no Duration);
  any other file, and every uploaded file, keeps its bytes.
- Capture stops after 60 seconds or when the browser stops sharing. Tracks, timers and preview URLs
  are disposed on cancellation, replacement and unmount. Late callbacks cannot stop a newer capture.
- Recording bytes and preview URLs remain in memory. They never enter draft or idempotency storage.
  Reloading or leaving the page ends capture and loses unsent recordings; the browser asks before leaving
  with a recording. This feature does not continue recording across full document navigation.

## Upload and recovery

Send initializes an authorized upload session, PUTs bytes directly to its scoped location without
cookies, reviewer headers or referrers, then completes the upload before sending `recordingId` with the
comment or reply. The shared helper accepts an actor scope, so uploads cached for a previous reviewer
cannot be reused after an account switch. Clip keys identify upload retries without storing bytes.
The helper retains a known session and completed recording id after a failed send; retries do not
create another recording. A failed immutable PUT may return 412 when its previous response was lost;
completion then inspects that existing upload. Failed sends keep their text and recording, and feedback
restores its detached recording only if the reviewer has not attached a newer one.

The project upload base is `/api/review/<project>/recordings`; public comments use
`/api/comments/recordings`. Packaged clients broker these JSON operations through the worker's closed
extension contract. Binary PUTs use only the scoped upload grant. A restrictive reviewed-page CSP must
allow the exact Blob origin in `connect-src`, and `media-src` must allow it plus `blob:` for previews.
Page/iframe Permissions Policy can deny display capture; upload remains available when capture is
unavailable. Capture or upload errors retain the comment text and selected file.

## Playback

Load recording obtains a private, short-lived URL after the API checks current comment access. Root
recordings use `.../comments/<id>/recording`; reply recordings use
`.../comments/<id>/replies/<itemId>/recording`. Playback URLs stay in the mounted player, never in comment
records, drafts or exports. Seeking or resuming an expired URL requests a new authorized URL and
restores the playback position. The Load recording button shows the clip's length, rounded down like
the player's own. A failed read offers Retry. Native controls support keyboard playback,
seeking and full screen; recordings do not autoplay.
