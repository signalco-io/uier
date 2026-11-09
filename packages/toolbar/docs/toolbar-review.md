# Reviewing uier's own toolbar

On uier's own pages every part of the toolbar can be commented on like page content: the pill, the
inbox, a saved comment's thread and the toolbar's popovers and menus (options, profile, feedback form,
thread options and status, message options, copy menu, device details, screenshot, the inbox's location filter).
Everywhere else the toolbar stays out of point mode and out of anchors.

## Where it applies

`canReviewToolbar()` (`src/toolbarReview.ts`): the page's origin is the configured API's origin, the
uier that serves the page (production, previews, local development). A third-party page cannot change
its own origin, and a toolbar it points at an API on that origin does not talk to uier. The review API
refuses toolbar anchors from a project's sites on its own (`apps/web/src/lib/review/toolbarAnchors.ts`:
the anchor, the end of a text selection or the opener, whenever the request has a cross-origin
`Origin`), so nothing about the toolbar's internals can be stored from another site.

## Picking

- The parts are named in `src/toolbarParts.ts` (pure, shared with the feedback packet and the app): the
  pill and the inbox by their ids (`#uier-feedback-toolbar`, `#uier-panel-inbox`, as before), popovers
  and menus by a class on the popover (`div.uier-thread`), since a popover's id is the one it gives
  itself for its button's `aria-controls`. Toolbar popovers take `toolbarSurface(part, className)`:
  the class, `onInteractOutside` and `onCloseAutoFocus` (below). A new toolbar popover gets a part, or
  stays out of review on purpose.
- Not parts: pins and highlights (what is under them is pinned), the point-mode outline, pointer,
  drawn area, instruction and its Cancel, the comment being written (a draft's popover), the first-run
  hint (Add comment closes it), tooltips, toasts and the selection toolbar.
- Anchors are `#uier-toolbar>>>` and the part's segment, then `tag:nth-of-type(n)` down to the element
  (`toolbarAnchorSelector`). A saved comment's pin has the id `uier-pin-<comment id>`, so it can be an
  opener, never an anchor the picker chooses.
- The outline, drawn area and pointer are above every toolbar popover on uier's own pages (`z-[95]`);
  pins of comments on the toolbar are above the popovers (`z-[75]`), and their threads above those
  (`z-[78]`).

## Popovers stay open while they are reviewed

Focus moves inside the toolbar's shadow root never reach the document, so a toolbar popover closes on
a press outside it. On uier's own pages that press does not close it when it is on Add comment
(`data-uier-holds-layers`), while an anchor is chosen (`holdToolbarLayers`, a layout effect of the
point overlay, so the hold ends before the new comment's text box takes the focus), or on the pin or
popover of a comment on the toolbar (`data-uier-holds-layers`, `CommentBubble`). A touch's press is
read on its click, from `watchToolbarPresses`. Escape, a popover's own controls and its button still
close it.

When a new comment starts (`startDraft`), `closeToolbarLayers` closes the popovers it is not in with
their buttons, as the press would have: a comment on the page closes an open thread, as on other sites;
one on a part of a thread keeps that thread open. A closing popover leaves the focus where it moved in
the toolbar (the new comment's text box) instead of returning it to its button. The point overlay takes
only trusted presses, so these clicks (and a page script's) never pin a comment.

## Openers and showing a comment again

- `withLayer(anchor, element)` saves the openers of the popover, menu or panel a part is in
  (`toolbarLayerOpeners`, outside in): each the expanded button whose `aria-controls` names a layer.
  The outermost is `layer.opener`: a thread's pin, a button of the pill (Options, Profile, Send
  feedback) or Inbox, which names the inbox panel in its `aria-controls` while it is open. The label is
  its name without its count or state ("Comment #6", "Inbox"). For nested layers (Copy issue in an
  open thread's Copy menu) the buttons that open the inner ones follow in `layer.nested` (toolbar
  anchors only, up to 7; the API refuses them with a page opener or from a project's sites).
- A toolbar anchor with a toolbar opener is looked for only in what that opener opens
  (`queryAnchorElements(selector, opener)`): two threads can be open at once and share their structure.
  Without the opener on the page, any match counts.
- While the layer is closed, the pin is beside the opener (`closed`, as for page menus). With nested
  layers it is beside the first closed opener from the outside in, each nested one looked for in what
  the one before opens (`closedLayerPlacement`): the thread's pin while the thread is closed, then Copy
  in the open thread. Only the outermost names its opener in the thread ("Open “Comment #6”…").
- Showing the comment (a comment link, Show on page, a new comment's thread) presses that opener
  (`CommentBubble`'s auto-open), waits for its layer to render and presses the next closed one, then
  opens the thread on the part. Each is pressed once; only collapsed toolbar buttons that open a
  layer (`aria-expanded="false"`, `pressableToolbarOpener`) are pressed, never any other control a
  saved selector names. Page openers are never clicked.
- Reviewed page layers use the same saved outer opener and closed-pin behaviour, but page openers
  are never pressed automatically. Their selectors skip framework-generated ids and keep bounded
  semantic alternatives; native invokers and the trigger observed opening a script dialog count even
  without aria-expanded/aria-controls. Page nested layers still save only the outermost opener:
  `layer.nested` remains restricted to toolbar anchors. See [anchor recovery](anchor-recovery.md).
- Automatic screenshots include the reviewed parts (everything matching `toolbarReviewSurfaces`) for
  these anchors, without pins, the outline or the comment being written.

## How it reads elsewhere

The app names the part ("Button in uier comment thread, after opening “Comment #6”",
`lib/app/commentAnchor.ts`), feedback packets say "Element in uier comment thread" and that the
selector after `#uier-toolbar>>>` is inside the toolbar's shadow root (`anchorLabel`, `feedbackMarkdown`).

## Tests

`apps/web/e2e/toolbar-review.spec.ts` (desktop and mobile): the pill and the inbox, a part of an open
thread (kept open, the pin as opener, a comment link opening it again), Copy issue in an open thread's
Copy menu (the nested opener, the pin moving layer by layer, a comment link opening both again;
Desktop Chrome) and the options popover (Show on page opening it again). `new-comment-after-thread.spec.ts`: a comment on the page closes the open
thread. `embed.spec.ts`: on a third-party site the toolbar and its threads stay out of point mode and
the review API refuses toolbar anchors. `toolbar-anchors.api.spec.ts`: `layer.nested` validation, the refusal
for reattaching, and the app's and the packet's words.

## Configured Give feedback choices

`ToolbarFeedback` reads the project's `feedbackTypes` from `ProjectGate` (older responses and
non-project hosts use `defaultFeedbackTypes`). Only enabled types appear, in wrapping rows. A
custom choice uses its configured icon, name and placeholder, and has its own draft/idempotency
key by stable type ID, including when the composer expands to `ComposerModal`. If the selected
type disappears after a settings refresh, the first enabled type is selected without deleting the
old type's draft. When every type is off, the Send feedback button is absent; a page's explicit
Give feedback request announces that pinned comments are still available. The server rechecks the
current enabled list when saving. `CommentKindLabel` uses each saved custom thread's display
snapshot, not today's type settings. Feedback choices stay within the existing `uier-feedback`
reviewable surface; expanding the composer retains the modal's existing non-reviewable behavior.
