# Screenshots and images

The automatic screenshot of a new comment, the reviewer's own image, and saved images. Formats, limits, storage
and what every client does are in [review workflow](../../../docs/review-workflow.md#screenshots). The rules that
apply to every toolbar change (capture, the composer's screenshot, attached images, image fetches) are in
[the toolbar guide](../AGENTS.md#rules).

## Capture

`src/screenshot.ts` draws the region of a new comment from the page, without the toolbar (`modern-screenshot`):

- The scroll is a negative margin, so fixed elements stay.
- Fonts are inlined.
- The content of `data-uier-decorative` elements is left out; they keep their `min-height`.
- It is encoded under the API's limits, with `toBlob` (#319): `src/screenshotEncoding.ts`, which also makes the reviewer's
  own large images smaller ([saved images](#saved-images)).

Capture starts from the feedback event, where the window and its scroll are read; inner scroll is recorded
after the composer's first paint ([capture responsiveness](composer-popovers.md#capture-responsiveness)). The page
is copied only after the composer's first frame, in pieces of about 8 ms that yield to the page
(`scheduler.yield`, else a message). Blocks more than a window's size from the window are left out: all of a block
below it in a block's flow, else its content. The copy keeps every element's `width`/`height`; sticky elements
and shadow roots are always kept.

Restored or reopened drafts refresh the capture without persisting images. A drawing is painted into it
([canvas mode](canvas-mode.md#the-comment-and-its-draft)).

## The form

New comment and feedback forms render `ComposerAttachmentsHeader` above (not inside) `CommentComposer`
(`components/ComposerAttachments.tsx`): the title and Expand. The screenshot (`ComposerScreenshot`) is in the text
box's bottom-left corner after Attach ([uier #391](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_napwWAvckuKEmZr-J0GGQ), [uier #476](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2F&comment=comment_MHq-BrZmONnqI7ugzvoOX)):

- A small thumbnail of the capture (the row's 28 px height, 44 px on touch screens), a button named **Preview
  screenshot** with the read-out capture status as its description. It opens the capture in [the viewer](#the-viewer)
  (**Screenshot**; Escape or its X closes it and the focus goes back to the thumbnail). The thumbnail is
  the capture as it will be sent, with the comment's drawing. Like the rest of the comment being written, the preview
  is not a reviewable toolbar part (no `toolbarSurface`).
- While it is being taken, a placeholder of the thumbnail's size (`data-image-placeholder`, still with reduced motion)
  holds its place.
- **Remove screenshot**, an X after it in the same outlined chip, so it does not read as Discard (28 px, 44 px on touch screens), also while it is being taken: `screenshot` is
  left out of the request. **Attach screenshot**, a camera, then takes the thumbnail's place and always takes a new one of the page as it is
  now, never the removed one; a removal drops the capture, finished or not.
  Each takes the focus from the other.
- Nothing shows while a capture that failed is not removed, nor while an image is attached.

**Attach image**, an item of Attach's menu (`ComposerAttachMenu`), sends the reviewer's own image, picked or pasted
into the form, as `screenshot` instead of the capture. Once one is attached, a chip like the screenshot's follows
Attach and the item leaves the menu: its thumbnail (`ComposerThumbnail`, a button named **Preview attached image** and
the file's name) opens it in [the viewer](#the-viewer), titled with that name, and its X removes it (**Remove attached
image** and the name) ([uier #506](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_gkdJSkWPR3jhvVCFEOmab)).

One [screen recording](recordings.md) can be attached alongside the screenshot or supplied image.
Record screen and Upload recording are items of the same Attach menu; a recording has its own preview and limits.

## Saved images

`src/screenshotPolicy.ts`, `src/suppliedScreenshot.ts`, `components/ScreenshotRedaction.tsx` and
`hooks/useReplaceScreenshot.ts`:

- Saved evidence can be uploaded or pasted, and redacted with opaque rectangles, using the shared API limits.
- `suppliedScreenshot` checks every image the reviewer supplies (Attach image, a paste, Upload image, replies in the
  app): PNG, JPEG or WebP of at most 25 MB (`MAX_SUPPLIED_IMAGE_BYTES`). It is decoded from the file
  (`createImageBitmap`, so a host's `img-src` does not apply). One within the API's 512 KB and 4096 px on a side is
  sent as it is. A larger one, as most full-screen screenshots are, is drawn at most 2400 px on a side and encoded
  like a capture (WebP of at most 480 KB; JPEG on white where the browser makes no WebP, so transparent window
  shadows do not turn black).
- `CommentScreenshot` keeps the thumbnail alone. Upload image and Paste image are in its expanded view beside
  Redact screenshot. A comment without a screenshot shows nothing for it: no "No screenshot" row.
- **Attach to comment** (`components/CommentAttach.tsx`, [uier #473](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_qLw4Rx21hSb1QWTtYlSeN)) adds what a saved
  comment's first message does not have yet. It is one paperclip in [the thread's header line](comment-thread.md#the-header),
  after Add reaction, for those who may edit the comment (its author, or a project's admin), and its menu is like
  the reply box's Attach:
  - **Take screenshot**, an after-comment screenshot: `captureCommentScreenshot` of the commented part of the page
    as it is now (the window for page feedback), without the toolbar, with the comment's drawing. Only on the
    document the comment was left on: its canonical page at its recorded source origin (as Reattach comment's
    original site). Addresses that share feedback show each other's threads, but none takes a screenshot for
    another's comment, nor does a comment whose source was removed or never recorded. Public comments are kept
    per site, so their page is enough.
  - **Attach image** and **Paste image**, also a keyboard paste while Attach or its menu has the focus.
  - Record screen and Upload recording, while the comment has no [recording](recordings.md#a-recording-for-a-saved-comment).
  Each image is saved through the same replacement request (`expectedRevision: null`), so the formats, limits,
  re-encoding and daily image budget are the saved images' own; once saved it is redacted or replaced from the
  expanded view. What is being saved and what failed show in a slot under the message that takes no room while
  empty; success is announced, and the thumbnail appears. With nothing left to add, the button goes and the new
  evidence takes the focus it had. The app's `CommentCard` has no such row or control.
- A comment or reply that is still sending with a screenshot or image shows the thumbnail's placeholder
  (`data-image-placeholder`, the thumbnail's fixed size) at once; the image is fetched once the saved message
  replaces it ([uier #409](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_ZGmj2h7nGoa5E6mpHV0zU)).
- Saved thumbnails expand in [the viewer](#the-viewer) (the reviewable `uier-screenshot` part), as wide as the image
  and at most the window, at the full width while redacting. Redaction opens only from the expanded saved details,
  never from the composer's preview.
- A replacement invalidates cached originals and updates every comment list.

## The viewer

`components/ScreenshotViewer.tsx` shows every larger image: a saved thumbnail's, the composer's screenshot and an
attached image ([uier #497](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_ZARYEuzrlcExd87wEYnaI), [uier #500](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_5VhIq3zftw4fCxaXVLMEW)):

- In the middle of the window over a blurred backdrop like the composer modal's; a press on the backdrop closes it.
  It is still the UI kit's popover, so Escape closes only it (not the thread or form it opened from) and the focus
  goes back to its thumbnail; it takes the focus itself when it opens, so Close's tooltip does not show at once.
  `toolbar-theme.css` fills the window with its popover's positioned wrapper, which is the backdrop.
- Above every toolbar popover: `z-[78]`, the threads of comments on the toolbar, and later in the shadow root than the
  thread it opened from, so above that one too. Tooltips and point mode stay above it, and so do the pins and drawings
  of comments on the viewer itself (`isScreenshotViewerAnchor`, `z-[79]`, `z-[80]` hovered); other pins are under it.
  Attach's menu shares the `z-[78]` level, so it is above the form it opens from, a new comment on the viewer too.
- A header with **Move screenshot**, its title and Close, an X icon button with a tooltip (**Close screenshot**,
  **Close image**). The header drags it, with a mouse, pen or touch; part of the header always stays in the window, and
  every opening starts in the middle again. Without dragging (WCAG 2.5.7), Move takes the arrow keys (16 px, 64 px
  with Shift), and a press on it (Enter, Space, a click that did not drag) puts the viewer back in the middle.
- Its parts are in the header and a body under it, so saved toolbar anchors from before the header, by position
  from `div.uier-screenshot` (its Close button, its image), no longer match by selector: they go through
  [anchor recovery](anchor-recovery.md) like any changed page. Anchors on the viewer itself still match.
- On uier's own pages presses go through the backdrop, so the pill's Add comment reaches the viewer, and a press in
  the viewer keeps the toolbar's other popovers open (`data-uier-holds-layers`).

## Tests

`apps/web/e2e/screenshots.spec.ts`: Attach, the screenshot's thumbnail, its preview and Remove screenshot in the text box, an attached image's thumbnail and preview, and pasted images too large for the API made smaller.
`toolbar-review.spec.ts`: the viewer above a toolbar comment's thread, dragged by its header, and that thread kept open;
moved with the keyboard and back to the middle; a comment on it, whose Attach menu and pin are above it. `thread-attachments.spec.ts`:
Attach to comment on a saved thread; `screenshot-replacement.spec.ts`: saved images, their errors and redaction. `screenshot-performance.spec.ts`: capture yields
to the browser ([capture responsiveness](composer-popovers.md#capture-responsiveness)).
