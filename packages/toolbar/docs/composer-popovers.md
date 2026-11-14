# New comment and feedback popovers

A new comment opens its form in a popover on its pin (`CommentBubble` with a `draft`); feedback and bug
reports open theirs from the pill (`ToolbarFeedback`). Both can expand to a modal for focused writing, and a
posted comment's thread opens in the draft's place.

The pill's feedback button is highlighted (`soft`, like the inbox) while its form is open, however it opened:
the button, or the page's "Give feedback" (`openUierFeedback()`). Pressing it again closes the form: the press
reaches the popover as the shadow host (retargeted), so `ToolbarFeedback` keeps the popover open for a press on
its own button and lets the click toggle it
([uier #325](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_7raLAPRiP1Uw10hx9_--G)).

## The form

`ComposerAttachmentsHeader` is the title line: the title and Expand (and an attached image's problem).
The bottom-left corner of the text box holds **Attach** (`ComposerAttachMenu`, a paperclip) and then the screenshot
toggle (`ComposerScreenshotToggle`, `CommentComposer`'s `attachments`), so both read as a part of the comment
([uier #391](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_napwWAvckuKEmZr-J0GGQ)). Attach is one button with a menu of what can be added now: Attach image, Record screen
(where the browser can capture) and Upload recording; an item leaves the menu once its kind is attached, and the
button goes when nothing is left. The menu renders in the expanded modal's dialog when there is one, else in the ink
scope or the shadow root. Once an image is attached, its name with a remove button follows Attach and the screenshot
toggle makes way (the image replaces the screenshot). Screenshot
rules: [review workflow](../../../docs/review-workflow.md#screenshots). Discard (once there is text) and Send are
icon buttons in the box's bottom-right corner, an X and a paper plane, each named by its tooltip (`IconTooltip`),
like every icon button in the form ([uier #289](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_5pAm5RcV57oGHBohkQrzH)).
Edits keep labeled Cancel and Save buttons. No line under the text box: what Enter and Shift+Enter do is in the
keyboard shortcuts list ([keyboard](keyboard.md)). The text box is the rich [message editor](message-editor.md):
Markdown typed in it formats as it is written, and a dropped image file is attached like Attach image
(`onImageDrop`). Its draft API is unchanged: `CommentComposer` keeps the Markdown and the mention ranges in
`useDrafts` under its `draftKey`, and `initialText`/`initialMentions` start an edit. No visible "@ to mention" hint
([uier #431](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_yPJEk4jKzwg5rDrkNrsOR)):
member text boxes keep the mention help in their screen-reader description, and typing `@` still opens the
mention picker.

New-message composers also accept one [screen recording](recordings.md). Capture controls and a recording's
preview belong to the form's owner, so expanding and collapsing retain it. Capturing, reading and uploading
follow the same send/recovery boundaries as the message; recording bytes never enter the saved draft.

`CommentComposer` is one bordered box: the text box (it grows with its text; Enter sends, Shift+Enter is a new
line, `enterKeyHint`), Attach (from `image` and `recording`), its `attachments` (the screenshot toggle), the
character counter near the limit, Discard while there is text, and Send.
Discard and Send are plain icon buttons with their tooltips: an X, since Discard has no labeled button beside
Send, and Send, since Enter sends. They are 44 px on touch screens. `beforeText` goes between the quote and the
box ([a rewrite's suggestions](#a-rewrite)). Screenshots and Attach image: [screenshots](screenshots.md#the-form).

### A rewrite

A rewrite suggestion (the selected text's **Rewrite**) is the same form, one card with one spacing
([uier #180](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_WMvFpcew7B7-K384zFTL4)):
the header ("New rewrite suggestion", Expand), the quoted text, the instruction box, the
suggestions once asked for, then the text box with the suggested text (it starts as the selected text), Attach
and Attach screenshot in its corner and Discard and Post suggestion inside it. `RewriteSuggestions` is `CommentComposer`'s
`beforeText`, inside its form: the instruction is one box like the text box (the AI mark, the field, Suggest as a
plain button), Enter in it asks for suggestions instead of posting (its `keydown` prevents the form's implicit
submission), and its buttons are `type="button"`. A picked suggestion replaces the text as if typed. The
instruction and the suggestions belong to the popover's owner (`useRewriteSuggestionsState` in `CommentBubble`),
like the attached image: Expand and Collapse keep them; closing the popover or Discard clears them.
`components/RewriteSuggestions.tsx` and `hooks/useRewriteSuggestions.tsx` ask `POST /api/rewrite` (with a
project, its review API) for the suggestions.

### A drawing

A drawing's comment ([canvas mode](canvas-mode.md)) is the comment form on the drawing's area, with **Edit
drawing** (a pen icon button in the header, `data-uier-edit-drawing`) beside Expand: canvas mode again
with the shapes, the text kept for when Comment opens the form again. The drawing stays on the page while the
form is open. Its draft is its own (`newDrawingDraftKey`, kind `drawing`); the drawing is in memory only, so
the form keeps it when closed without text, and shows **Discard** even when the text is empty, which removes the
drawing too.

## Drafts across reloads

Every message composer already uses `CommentComposer`'s `draftKey` and the shared seven-day
`draftStorage.ts` store: anchored comments and rewrites retain their anchor, feedback has a key per type,
replies use the thread id, and edits use `edit:<commentId>:<itemId>` with the original text snapshot.
Typing writes immediately; reopening the same box after a reload or toolbar remount restores its text and
mentions. The kept text is the cue: no composer says "Draft saved in this browser" under its box ([uier #218](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_xQbZJy4bLvce3eONhs0J-),
[uier #295](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fmy-work&comment=comment_kAQn2JJ3-PFQNEGtg3L2V)). Successful sends/saves and explicit Discard/Cancel clear the appropriate draft; failed or uncertain
sends retain it. A send the page never saw settle (it was reloaded or left meanwhile, or failed while it was being
left) comes back as a draft too, marked `unsettled`: it may have been saved. Once the page's comments are loaded and
one of yours has its text, it was, and the draft goes (`CommentsGlobal`), so a comment posted just before a reload is
not listed as unsent; one that was not saved stays. A plain failed send (an error shown in the form) is not marked.
The authorized reviewer, API, project and canonical page scope never includes a build id.
Screenshots, attached images and device details stay in memory. The app's own feedback-mode toolbar is
loaded on demand again with Give feedback after a document reload; this reuses the same draft keys.

`hooks/useDrafts.tsx` keeps the text, anchor and edit snapshots, scoped to the API, project, authorized
reviewer, canonical page and item. `draftStorage.ts` handles expiry, Discard, clearing on sign-out, blocked
storage (the draft stays in memory), stable submission identities and a page's list (`keys`, `subscribeAll`).
Captures stay in memory and are taken again when a form reopens. Storage and retries for every client:
[draft recovery](../../../docs/review-workflow.md#draft-recovery-and-submission-retries).

`apps/web/e2e/drafts.spec.ts` covers every toolbar composer, reloads, separate feedback kinds and edit snapshots;
`drafts-project.spec.ts` covers reviewer/project/page isolation. `app-composer-drafts.spec.ts` covers the toolbar
on `/app/projects/<id>`, including an app RSC refresh and Next.js's document navigation after deployment skew.

## Several drafts on a page

Each new comment and rewrite is a draft of its own ([uier #296](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fmy-work&comment=comment_SfAne_dyH6incZms-P4n2)): `startDraft` gives it its own key
(`newDraftKey`: `new:<id>`, `new-rewrite:<id>`), so Add comment, C or a selection never reopens an unsent draft
elsewhere; that one stays on the page as its closed pin. A comment or rewrite on the very same spot as an unsent one
(C on the same focused element, the same text selected again) goes on with it. A draft kept before there could be
several (`new`, `new-rewrite`) comes back as one of them. A drawing's comment stays one (`newDrawingDraftKey`: its
drawing is in memory, [canvas mode](canvas-mode.md)), and each comment's submission key is kept in its own draft
(`CreateCommentInput.draftKey`).

- The page's comment and rewrite drafts with text come back as closed pins on load and on each page
  (`restorePageDrafts`, the newest 50; the store's `keys()` lists a page's records). Records left without text (a
  form open when the page was left) are removed then, so they do not pile up. A closed pin is captured when its form
  opens or it is sent, not when it comes back, so many drafts cost nothing on load.
- **Resume draft** above the pill opens the latest closed one. The inbox lists them all.
- The inbox lists this page's drafts above its threads, newest first (`sidebar/InboxDrafts.tsx`, current through the
  store's `subscribeAll` and `version`): those with text whose form is closed, under Active and All, while the chosen
  pages include this page, not with the unread or Assigned to me filters, and only those with every word of the
  search. A card has "Draft comment" (or "Draft rewrite suggestion") and when it last changed, the quoted text, the
  text without its Markdown and, when its target is not on the page, why; then Resume draft (only while its pin can be
  placed), Post comment (Post suggestion) and Discard, an X named by its tooltip as in the form.
- Resume draft closes the inbox, unless the draft is on a part of it, and opens the form on its pin with its text,
  focused, like Resume draft above the pill.
- Post comment sends the draft as it is, without its form (`CommentDraftHandle.send` on its pin, the composer's
  steps: its text and mentions, its attached image or a new capture of its anchor, its submission key). An anchor
  outside the window is scrolled into view first, as Resume draft does, and captured once that has settled (a frame),
  so the screenshot is of its anchor, not of the window it was not in (`revealAnchor`); an anchor not on the page is
  captured as its form would (the window). No form or
  thread opens (`quiet`): its card goes, its thread is in the list and its pin on the page. A failed send is like a
  form's: the text is back, the draft is listed again (its pin closed, the error in its form) and the toast says why.
  A guest without a name, or an image still being read, opens its form instead.
- Discard removes the draft and says "Draft discarded". After Post comment or Discard the focus goes to the next
  card, else the inbox.

`apps/web/e2e/multiple-drafts.spec.ts` (desktop and mobile) covers two drafts on a page, a reload, the inbox's list
under Active (none under Done), Resume draft, a failed and a successful post from the inbox and Discard, the
screenshot of an offscreen draft posted from the inbox, and a comment saved while the page reloaded.

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

The thread's reply form uses the same Attach menu (Attach image) and `useAttachedImage` reader as a new comment,
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

Pins that would overlap (comments on the same element, or on elements close together) move apart just enough that
each is whole and can be pressed, its people included (`src/pinLayout.ts`,
[uier #367](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_ZLqfVrY3yni86N80l9OWY)).
Every pin, saved, being sent or a draft, reports where it would be by itself (`usePinShift`, one layout per mounted
toolbar); they are placed oldest first by number, drafts last, so a new pin never moves the ones already there. A pin
that would overlap goes just beside the pins in its way, to the right, else to the left, or to the next row below (above
an upside-down pin) once its row has grown long or reaches the window's edge, kept inside the window; pins clear of
others stay where they are. Pins keep 4 px apart, measured by their hit areas, so touch pins (44 px) spread
further. A draft on the same element as a saved pin goes beside it this way too. The layout is computed once after
the pins that moved have reported, before the browser paints, and scrolling (which moves every pin alike) renders no
pin twice.

The popover, a thread or a new comment's form, opens beside its pin on the side with room (right, else left;
`popoverPlacement`), down from the pin's top, or up from its bottom when the pin is upside down, and shifts up
or down to stay inside the window and clear of the pill. It never covers the pin. A window too narrow for
either side (mobile) has it below the pin, or above it when there is more room there or the pin is upside
down, shifted sideways to stay inside.

## Who is in the thread

A saved comment's pin shows the people in its thread beside it (`PinParticipants`,
[uier #307](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_v2LlQN7fAUCaHNj3Et-BL)):
the author, then everyone who replied, in the order they first wrote (`threadParticipants`: a message an AI agent
wrote for someone counts as theirs; deleted and unsent messages do not count). A small overlapping stack of 20 px
avatars with the same letters as the messages' avatars, ink (the dark tokens) like the pin; past three people, the
first two and "+N". It sits behind the pin and its message count badge, tucked 8 px under its right edge and
centred on it, or on its left when the window has no room on the right, so it never leaves the window. The author
is in front, each next avatar further back, 9 px overlapping; hovering or focusing the pin slides them out a little
(the first 6 px, each next 3 px more, still overlapping) and reduced motion jumps there without the slide
([uier #317](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2F&comment=comment_QR5QRD8w6bKTBnW6X-m79)). It is part of the pin's button (hovering and
pressing it are the pin's) and decorative: the letters are generated content (`content: attr(...)`), so the pin's
text and name stay its number and message count, and its description names the people ("In this thread: you,
Ana, and Ben"). Drafts and comments still being sent have none.

In the thread, each message's avatar names its author on hover or keyboard focus (`MessageAuthorAvatar`,
`useIconTooltip`, [uier #323](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_-b9ksSNB6R_PuRNAMiTff)):
the full name, "(you)" on your own, and "Written by Claude" with its model and reasoning level for a message an AI agent wrote for
its author (those two only for members, as in "via"). The avatar is a focusable `img` with the
same words as its name; not in a hover preview, which is inert.

## Hover preview

A mouse resting on a saved comment's pin for 400 ms opens a read-only preview of its thread in the same popover,
in the same place ([uier #308](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects&comment=comment_hWoACqYfuesBCMSV0ejjJ)):
"Comment thread preview", the thread `inert` (no presses, no focus, no tooltips), no reply box. It leaves the
focus where it is, does not mark the thread read, is not a thread for the shortcuts (`data-uier-thread-scope`) and
not a reviewable part of the toolbar. It shows every message, without "Show all", which it could not press, and the
wrapper around the inert thread is not inert, so the wheel over a long thread scrolls it inside the popover's
bounds ([uier #322](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_kX2useXkznTzd9GDZnVQO);
`CommentThread`'s `allMessages`). It closes 150 ms after the pointer leaves both the pin and the preview, and
on Escape or a press outside. The preview hides the thread's controls ([uier #320](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2F&comment=comment_TYufg9xk1VZCzxenJAKMJ)):
each control marked `data-uier-thread-control` (the status menu, Mark as read, Copy, Thread options, Add reaction,
a message's options, "Show all", Email me replies) is transparent but keeps its place, so nothing moves when the
thread opens; the status menu (`data-uier-status`, still inert) shows, as do the status badge without a menu, the
people and the reaction pills ([uier #322](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_kX2useXkznTzd9GDZnVQO)). A click on the
pin or anywhere in the preview (or Enter or Space on the pin) opens the thread itself, with its reply box focused,
its actions and its read receipt, and it then stays open like a clicked thread, with every message still shown; its controls fade in over 200 ms
(`data-uier-controls-reveal`, at once with reduced motion). Only a mouse
previews (`pointerType`), never while a button is held or in point mode (`isPointing`, `CommentPointOverlay`);
a tap, Enter or Space opens the thread at once, as before. Closing a preview never moves the focus to the pin.

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
  text when it mounts. Escape in the text box reaches the dialog: the editor passes it on unless a mention list
  takes it. Tooltips go into the dialog (`TooltipContainerContext`), not under it.
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
`pin-numbers.spec.ts` (desktop and mobile): pins on the same and nearby spots apart, the oldest on its anchor, each
opening its own thread; `pin-layout.api.spec.ts`: the layout itself (least move, order, window edges, rows, touch).
`pin-preview.spec.ts`: the people beside a pin (the author first and in front, tucked under the pin, sliding out on hover, "+N", its description, the left side at the
right edge; desktop and mobile), the hover preview (read-only, the focus kept, the status shown and the other controls
hidden, closing on leave, a click in it or on the pin opening the thread, a message's avatar naming its author; a long
thread's every message, scrolled by the wheel without scrolling the page and kept when it opens; desktop) and a tap
opening the thread at once (mobile).

The page-feedback draft regression checks the edit after reload in the automatically restored inbox; pressing Inbox again would close it and hide the restored edit.
