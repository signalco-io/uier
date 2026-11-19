# Screenshots and images

The automatic screenshot of a new comment, the reviewer's own image, and saved images. Formats, limits, storage
and what every client does are in [review workflow](../../../docs/review-workflow.md#screenshots). The rules that
apply to every toolbar change (capture, the screenshot toggle, attached images, image fetches) are in
[the toolbar guide](../AGENTS.md#rules).

## Capture

`src/screenshot.ts` draws the region of a new comment from the page, without the toolbar (`modern-screenshot`):

- The scroll is a negative margin, so fixed elements stay.
- Fonts are inlined.
- The content of `data-uier-decorative` elements is left out; they keep their `min-height`.
- It is encoded under the API's limits, with `toBlob` (#319).

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
(`components/ComposerAttachments.tsx`): the title and Expand. The screenshot toggle, **Attach screenshot**
(`ComposerScreenshotToggle`), is in the text box's bottom-left corner after Attach ([uier #391](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_napwWAvckuKEmZr-J0GGQ)). It has its
tooltip, `aria-pressed` and the read-out capture status as its description. Pressed while the screenshot will be sent
(also while it is being taken), it is ink (the UI kit's `solid`: `--primary` on `--primary-foreground`, black in
light and white in dark) with a check and a camera, so the choice shows before sending. Turned off, it is a plain
crossed-out camera and `screenshot` is left out of the request. It is hidden while a capture that failed is not
turned off, and while an image is attached.

**Attach image**, an item of Attach's menu (`ComposerAttachMenu`), sends the reviewer's own image, picked or pasted
into the form, as `screenshot` instead of the capture. Once one is attached, its name with a remove button follows
Attach and the item leaves the menu. Never an image preview. In a tight row the name truncates and the chip's icons keep their
size ([uier #396](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1%2Fpage-checks&comment=comment_7u8PpdTZvoj6z0h3M0fEy)).

One [screen recording](recordings.md) can be attached alongside the screenshot or supplied image.
Record screen and Upload recording are items of the same Attach menu; a recording has its own preview and limits.

## Saved images

`src/screenshotPolicy.ts`, `src/suppliedScreenshot.ts`, `components/ScreenshotRedaction.tsx` and
`hooks/useReplaceScreenshot.ts`:

- Saved evidence can be uploaded or pasted, and redacted with opaque rectangles, using the shared API limits.
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
- Saved thumbnails expand in a popover in the shadow root. Redaction opens only from the expanded saved details;
  composers never preview images.
- A replacement invalidates cached originals and updates every comment list.

## Tests

`apps/web/e2e/screenshots.spec.ts`: Attach and the screenshot toggle in the text box. `thread-attachments.spec.ts`:
Attach to comment on a saved thread; `screenshot-replacement.spec.ts`: saved images, their errors and redaction. `screenshot-performance.spec.ts`: capture yields
to the browser ([capture responsiveness](composer-popovers.md#capture-responsiveness)).
