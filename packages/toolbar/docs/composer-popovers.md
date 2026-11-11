# New comment and feedback popovers

A new comment opens its form in a popover on its pin (`CommentBubble` with a `draft`); feedback and bug
reports open theirs from the pill (`ToolbarFeedback`). Both can expand to a modal for focused writing, and a
posted comment's thread opens in the draft's place.

## The form

`ComposerAttachmentsHeader` is the title line: the title, the screenshot toggle (Omit screenshot, a camera icon) and Expand.
Attach image (`ComposerAttachButton`) is in the bottom-left corner of the text box (`CommentComposer`'s
`attachments`), so it reads as a part of the comment; once an image is attached, its name with a remove button
takes that place and the screenshot toggle leaves the header (the image replaces the screenshot). Screenshot
rules: [review workflow](../../../docs/review-workflow.md#screenshots). No line under the text box: what Enter and
Shift+Enter do is in the keyboard shortcuts list ([keyboard](keyboard.md)).

### A rewrite

A rewrite suggestion (the selected text's **Rewrite**) is the same form, one card with one spacing
([uier #180](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_WMvFpcew7B7-K384zFTL4)):
the header ("New rewrite suggestion", Omit screenshot, Expand), the quoted text, the instruction box, the
suggestions once asked for, then the text box with the suggested text (it starts as the selected text), Attach
image in its corner and Discard and Post suggestion inside it. `RewriteSuggestions` is `CommentComposer`'s
`beforeText`, inside its form: the instruction is one box like the text box (the AI mark, the field, Suggest as a
plain button), Enter in it asks for suggestions instead of posting (its `keydown` prevents the form's implicit
submission), and its buttons are `type="button"`. A picked suggestion replaces the text as if typed. The
instruction and the suggestions belong to the popover's owner (`useRewriteSuggestionsState` in `CommentBubble`),
like the attached image: Expand and Collapse keep them; closing the popover or Discard clears them.

## Drafts across reloads

Every message composer already uses `CommentComposer`'s `draftKey` and the shared seven-day
`draftStorage.ts` store: anchored comments and rewrites retain their anchor, feedback has a key per type,
replies use the thread id, and edits use `edit:<commentId>:<itemId>` with the original text snapshot.
Typing writes immediately; reopening the same box after a reload or toolbar remount restores its text and
mentions. Such a restored composer says "Draft saved in this browser" under its box, except the feedback form
(`draftCue={false}` in `ToolbarFeedback`): there the kept text is enough of a cue ([uier #218](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_xQbZJy4bLvce3eONhs0J-)). Successful sends/saves and explicit Discard/Cancel clear the appropriate draft; failed or uncertain
sends retain it. The authorized reviewer, API, project and canonical page scope never includes a build id.
Screenshots, attached images and device details stay in memory. The app's own feedback-mode toolbar is
loaded on demand again with Give feedback after a document reload; this reuses the same draft keys.

`apps/web/e2e/drafts.spec.ts` covers every toolbar composer, reloads, separate feedback kinds and edit snapshots;
`drafts-project.spec.ts` covers reviewer/project/page isolation. `app-composer-drafts.spec.ts` covers the toolbar
on `/app/projects/<id>`, including an app RSC refresh and Next.js's document navigation after deployment skew.

## Capture responsiveness

Window dimensions and page scroll are read at the feedback event. Inner-scroll recording and
offscreen-element checks now wait for the composer's first paint and share the clone's 8 ms
work budget. Both traversals yield and check cancellation between elements; scroll recording uses a
TreeWalker instead of building a whole-page array. Partial scroll marks are cleaned up on cancellation.
If page scroll changes during the offscreen scan, pruning is discarded for that capture. Encoding
continues to use `toBlob`; no worker or new dependency is needed. These changes stay in capture code,
so the screenshot toggle and image attachments use the same promise and cancellation contract.

Measured locally in headless Chromium, 1674 × 1366, 4× CPU throttling, 20,000 feedback-like rows
(100,000 elements), three fresh pages per version: before, the initiating call took 101–119 ms,
with a second 372–415 ms long task; after, initiation took about 1 ms and the largest long task
was 68–79 ms. Total capture time increased from 1.15–1.19 s to 1.37–1.56 s. These are synthetic
measurements, not an Edge production trace: library rendering/serialization can still produce a
long task, but preparation no longer runs as an unbroken whole-page scan. The regression in
`screenshot-performance.spec.ts` checks that capture yields to the browser before all inner-scroll reads finish,
while the composer keeps typed text and capture completes.

## Reply images

The thread's reply form uses the same Attach image control and `useAttachedImage` reader as a new comment,
including file and paste validation, the filename/remove state and holding send while an image is read.
Replies have no automatic capture: one attached image belongs to that reply and never replaces the first
message's screenshot. A send clears the attachment; a failed send restores it only without a newer attachment.
Discard clears it. Bytes stay in memory, outside draft and idempotency storage; only an opaque attachment key
identifies a retry in the browser. Saved reply images use `CommentScreenshot`'s lazy thumbnail and expansion,
with the parent thread and item ids in both the request and query key. Image edits remain on the original
comment's screenshot. The app shares the reader, with its own shadcn controls and thumbnail/dialog.
`apps/web/e2e/reply-images.spec.ts` covers both surfaces on desktop and mobile.

## Where the pin and its popover go

A pin sits 16 px below and right of its anchor (`bubbleLeft`, `bubbleTop` in `CommentBubble`), kept inside
the window sideways. When that place leaves the bottom of the window, or goes under the toolbar pill at the
bottom edge, while the anchor's bottom is still in the window (an element or area that ends at the bottom
edge, [uier #166](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_H_TrIieqwg6OA4Px0efJx)),
the pin goes above that point upside down (`<Pin upsideDown />`, `data-uier-upside-down`), its sharp corner
still on the point, inside the window and above the pill. An anchor below the window keeps its pin below
it, off-screen until scrolled to. The pin's button has the pin's shape (round, with no radius on the sharp
corner: top-left, or bottom-left upside down), so its focus ring follows the pin, not a circle
([uier #286](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_1z_xazrZorbfQTPCYKfJ2)).

The popover, a thread or a new comment's form, opens beside its pin on the side with room (right, else left;
`popoverPlacement`), down from the pin's top, or up from its bottom when the pin is upside down, and shifts up
or down to stay inside the window and clear of the pill. It never covers the pin. A window too narrow for
either side (mobile) has it below the pin, or above it when there is more room there or the pin is upside
down, shifted sideways to stay inside.

## Posting: one popover

Sending a new comment never closes one popover to open another. `handleCreated` in `CommentsGlobal` marks the
draft `sentAs` the comment's temporary id and keeps it on the page until the comment is in the list (the
query cache notifies a task later); in that same render the draft goes and the comment's pin comes with its
thread open (`continuesDraft`): no opening animation, the thread at its full size from the start. While the
comment is being saved the popover is "Sending comment" and its reply box is there already, read-only
(`CommentComposer`'s `waiting`), with the focus; once saved it is the same popover ("Comment thread", the React
key is the temporary id, `commentKey`), the reply box editable and still focused. A failed send brings the draft
back as before. Opening the thread again later animates as usual.

## Expanding to a modal

Expand (at the end of the header; `ExpandComposerButton`, named "Expand", then "Collapse") turns the popover
into `ComposerModal`: a native `<dialog>` shown with `showModal()` in the toolbar's shadow root, so it is in the
top layer, the page and the rest of the toolbar are inert behind its backdrop, Tab stays in it and it is
announced as a dialog with the form's name ("New comment", "Send feedback"). It is wider (up to 40rem) and its
text box starts at 8 lines (`CommentComposer`'s `tall`).

- The form goes on: the text and mentions are in the drafts, and the attached image, the screenshot (and the
  choice to omit it), the feedback type, a rewrite's instruction and suggestions and the capture belong to the
  form's owner, so the composer can mount
  again in the modal and back in the popover. A guest's name typed but not sent is kept too, for that form only (by its draft key), so another form never starts with it.
- Collapse, Escape (the dialog's `cancel`, prevented) and a press on the backdrop go back to the popover, never
  close the form; a browser that closes the dialog anyway (a repeated Escape) goes back too. Sending from the
  modal closes it like the popover: feedback closes, a comment's thread opens on its pin.
- The popover is closed while the modal is open, at once (`data-[state=closed]:animate-none!`), and its own
  close (the focus moving into the modal) is ignored (`expandedRef`), so it never cancels the draft.
- The form mounts once the dialog is shown: a closed dialog has no layout, and the text box sizes itself to its
  text when it mounts. Tooltips go into the dialog (`TooltipContainerContext`), not under it.
- The modal carries the comment being written, so it is not a reviewable part of the toolbar; a comment on a
  toolbar part keeps that part's popover open from the modal too (`data-uier-holds-layers`). Letter shortcuts
  do not act in it ([keyboard](keyboard.md)).

## Tests

`apps/web/e2e/expanded-composer.spec.ts` (desktop and mobile): feedback expanded and back with its text, type,
image and screenshot choice, Escape, Collapse and sending; a new comment's modal, Tab staying in it, the
backdrop and posting. `rewrite.spec.ts`: a rewrite's form in order, Enter in the instruction not posting, and its
instruction and suggestions kept in the modal and back. `new-comment-after-thread.spec.ts`: posting keeps one popover open (no gap, no opening
animation, the same element once saved). `screenshots.spec.ts`: Attach image in the text box.
`showcase.spec.ts` (desktop and mobile): a pin at the bottom and right edges is upside down, its thread inside
the window, clear of the pill and the pin.
