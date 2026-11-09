# New comment and feedback popovers

A new comment opens its form in a popover on its pin (`CommentBubble` with a `draft`); feedback and bug
reports open theirs from the pill (`ToolbarFeedback`). Both can expand to a modal for focused writing, and a
posted comment's thread opens in the draft's place.

## The form

`ComposerAttachmentsHeader` is the title line: the title, the screenshot toggle (Omit screenshot) and Expand.
Attach image (`ComposerAttachButton`) is in the bottom-left corner of the text box (`CommentComposer`'s
`attachments`), so it reads as a part of the comment; once an image is attached, its name with a remove button
takes that place and the screenshot toggle leaves the header (the image replaces the screenshot). Screenshot
rules: [review workflow](../../../docs/review-workflow.md#screenshots).

## Where the pin and its popover go

A pin sits 16 px below and right of its anchor (`bubbleLeft`, `bubbleTop` in `CommentBubble`), kept inside
the window sideways. When that place leaves the bottom of the window, or goes under the toolbar pill at the
bottom edge, while the anchor's bottom is still in the window (an element or area that ends at the bottom
edge, [uier #166](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_H_TrIieqwg6OA4Px0efJx)),
the pin goes above that point upside down (`<Pin upsideDown />`, `data-uier-upside-down`), its sharp corner
still on the point, inside the window and above the pill. An anchor below the window keeps its pin below
it, off-screen until scrolled to.

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
  choice to omit it), the feedback type and the capture belong to the form's owner, so the composer can mount
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
backdrop and posting. `new-comment-after-thread.spec.ts`: posting keeps one popover open (no gap, no opening
animation, the same element once saved). `screenshots.spec.ts`: Attach image in the text box.
`showcase.spec.ts` (desktop and mobile): a pin at the bottom and right edges is upside down, its thread inside
the window, clear of the pill and the pin.
