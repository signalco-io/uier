# Canvas mode

Draw on the page (the pill's button after Add comment, a brush, the panel's Brush icon) lets a reviewer draw on the live page and
send the drawing as one comment ([uier #276](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_os3tIIsf4quE9caFmRA3S)).
Every shape drawn in one session becomes one comment on an area, the drawing saved with it as vector
shapes: shown to everyone who sees the comment, where it was drawn, and painted into its screenshot.

It is the optional toolbar feature `draw` (`toolbarFeatures.ts`; [toolbar features](../../../apps/web/docs/project-settings.md#toolbar-features)):
a project that hides it gets no button, no canvas, no drawing drafts. Saved drawings still show with
their comments.

## The drawing

`src/drawing.ts` (`@uier/toolbar/drawing`, pure: the API validates with it) is the data:

- `CommentDrawing`: `{ version: 1, width, height, shapes }`. The shapes are in CSS pixels from the
  top-left corner of the comment's area; `width` and `height` are the area's size when it was drawn.
- Shapes: `pen`, `marker` and `brush` (flat `points` `[x, y, x, y…]`, a pen's optional `pressures`
  0–100), `line` and `arrow` (`x1 y1 x2 y2`, `sketchy` for a hand-drawn arrow), `rectangle`, `ellipse`
  and `diamond` (a box; Shift draws a square or a circle), `text` (a note: a box and up to 500
  characters on 20 lines) and `blur` (a box). Every shape has an `id` and a `seed` (a sketchy line's
  wobble stays the same).
- Style: `color` and `fill` are names of the brand's drawing colours (`--brand-draw-ink`, `white`,
  `red`, `amber`, `green`, `blue`, `violet` in `tokens.css`), never values; `size` is `s`–`xl` (line width,
  or a note's font size); `dash` (`dashed`, `dotted`) and `fillStyle: 'solid'` (a semi-transparent fill
  otherwise) are optional.
- `parseDrawing` is the one validator: a closed vocabulary, finite numbers within `drawingLimits.side`
  (20,000), unique ids, at most 200 shapes, 1,000 points a line and 6,000 in all, and 32,000 characters
  of JSON. It returns only the known fields; a note's text drops controls (bidirectional ones too) and
  trailing spaces. `commentDrawing` reads a stored one defensively (`undefined` when it does not parse).
- `drawingSummary` names the shapes in English for the feedback packet ("1 arrow, 2 rectangles") and
  lists the notes.

`canvas/geometry.ts` turns a shape into its parts (SVG path data, with widths, dashes and opacity),
used both by the page's SVG and by the screenshot's canvas, so they draw the same thing. It also hit-tests,
moves and resizes shapes, simplifies freehand lines (Ramer–Douglas–Peucker) and snaps a line with
Shift to 15° steps.

## Drawing

`components/canvas/CanvasMode.tsx` covers the window with a transparent surface (`data-uier-canvas`,
`role="application"` named "Drawing", `touch-action: none`) above the page and below the pill;
`CanvasPanel.tsx` is the tool panel (`role="toolbar"` "Drawing tools", one tab stop with ← →, at the top
centre): Select, Pen, Marker, Brush, Line, Arrow, Rectangle, Ellipse, Diamond, Text note, Blur, Eraser;
Style (a popover: colour, background and its fill, outline, width, edges: clean or sketchy); Undo,
Redo, Delete; Discard and Comment. A selected shape's style changes with the popover, and the next shapes
take it. Blur has no style: with the Blur tool or a blurred area selected, Style is
`aria-disabled` and its tooltip and description say why ("Blur has no colour or width"); it opens nothing
([uier #314](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_DnOBAJNJAzRTeqesg43fD)).
Select and Eraser keep it: their style goes to the selected shape or the next ones.

- Shapes are kept in the content coordinates of one scroll container, the session's frame
  (`canvas/finish.ts`): the page, or the scrolled element the first shape is drawn over (an app whose main
  column scrolls). They stay on what they were drawn over when it scrolls. A drawing drawn on again (below)
  goes on in the frame its comment's area is in (`frameOf` its anchor element, `shapesInFrame`). A wheel or
  two-finger move on the surface scrolls what is under it (`scrollTargetAt`).
- Select picks the topmost shape; drag moves it, its handles resize it. Clicking a shape with another tool
  draws a new one. The eraser removes what it passes over.
- Undo and Redo go back and forward through every change (100 steps), in the session only.
- A text note opens a text box in place (`data-uier-canvas-text`); Esc, Ctrl/⌘+Enter or leaving it keeps
  it, an empty one goes. Text note on a note (or Enter on a focused one) edits it again.
- Blur blurs what is under it with `backdrop-filter` on the page (nothing above it may set a filter or
  opacity: that would blur nothing) and from the screenshot's own pixels in the screenshot.

**Comment** (`finishDrawing`) scrolls the drawing's bottom into the window, takes the shapes' box with
8 px around it as the comment's area, anchored like a dragged area on the innermost element that holds all
of it (`isCommentArea`), and moves the shapes to that area's top-left corner. The new comment's form opens
on it, like a point's. A drawing beyond the limits stays in canvas mode with a message.

**Discard**, or Esc with nothing drawn, leaves without a comment; the pill's button again moves the
focus to Comment instead of losing the shapes. Collapsing the toolbar or leaving the page ends canvas
mode.

One session, one comment: while a drawing's comment is unsent (its form open or closed), the pill's button
goes on with that drawing (`resumeDrawing`, like Edit drawing) instead of starting another that would replace
it. When its area is not on the page as it was drawn, its form opens instead, like Resume draft.

## Keys

The surface is focused when canvas mode starts. With the shortcuts on, each tool has a letter (V, P, M, B,
L, A, R, O, D, T, X, E; in its tooltip); the surface handles them before the toolbar's own keys, which
do nothing while drawing. Ctrl/⌘+Z undoes, Ctrl/⌘+Shift+Z and Ctrl+Y redo, Delete or Backspace deletes the
selected shape, Esc cancels a drag, then deselects, then (with nothing drawn) leaves.

Without a pointer: Enter on the surface adds the tool's shape in the middle of the window (a line, an
arrow, a box, a note; freehand tools say they need a pointer). Every shape is a focusable button
(`data-uier-canvas-shape`, "Rectangle 2"): focus selects it, the arrows move it (Shift: 10 px), Alt with
the arrows resizes it, Enter edits a note. Announcements go to the toolbar's live region (started, added,
deleted, undone, redone, discarded, full, too large).

## On the page

`components/canvas/DrawingLayer.tsx` draws shapes as one fixed SVG (notes and blur areas as HTML), moved
with `transform` (no `will-change`: the blur needs to see the page). A comment's drawing is drawn at its
area (`useCommentItemRects`), so it follows the element when it moves or scrolls, and is hidden with the
comment: same visibility, filters, resolved and archived state as its pin. It never takes clicks; the
pin opens the thread, and the area's dashed outline shows only while its thread is open.

## The comment and its draft

A drawing's draft is its own kind (`'drawing'`, `newDrawingDraftKey`), beside a pin's and a rewrite's.
Its text and anchor are kept like theirs; the drawing is kept in memory only (not in browser storage), so
after a reload the text comes back with the next drawing. Closing its popover without text keeps it,
since there is a drawing to lose; the form shows **Discard** for it. **Edit drawing** (`data-uier-edit-drawing`)
in the form goes back to canvas mode with the shapes on the content they were drawn on, in their scroll
container; Comment then opens the form again with the text. It is offered only while the area is on the
page (not on the opener of a closed menu, popover or dialog). The submission key covers a fingerprint of the drawing (`drawingFingerprint`),
not the drawing itself.

The screenshot (`captureCommentScreenshot` with the drawing; `src/screenshot.ts`) paints the drawing onto
the captured area at the capture's scale (`canvas/paint.ts`): blurs first, then the shapes, then the notes,
in the toolbar's resolved colours. The packaged extension's capture gets the same painting before it is
encoded. A blurred area's pixels are blurred at an eighth of their resolution; Redact screenshot stays the
way to cover something completely.

## Feedback packet

`feedbackDrawing` adds `drawing: { shapes, summary, width, height, notes }` to the packet of a comment
with one, and the Markdown says what was drawn and that the screenshot includes it; the notes' text is
untrusted and fenced like messages ([feedback context](../../../docs/feedback-context.md)).

## Tests

- `apps/web/e2e/canvas-drawing.api.spec.ts`: saving with only the known fields, listing, the packet, and
  every refusal (not an area, unknown shape or colour, limits).
- `apps/web/e2e/canvas-mode.spec.ts`: drawing shapes and a note, undo and redo, style, Comment, the drawing in
  the screenshot and on the page after a reload and scroll (full suite); the keyboard path; Edit drawing
  (`@mobile-smoke`); the pill's button going on with an unsent drawing, and Edit drawing in a scrolled
  panel keeping the shapes on its content (full suite).
