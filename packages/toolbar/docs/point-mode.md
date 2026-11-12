# Point mode, areas and selected text

How a reviewer picks what a comment is about: an element or an area in point mode, or selected text.
`components/CommentsGlobal.tsx` is the toolbar's top level: the pins (in page order), point mode and its
keyboard path, selection handling, the focus after posting ([one popover](composer-popovers.md#posting-one-popover))
and the first-run hint. Collapsing cancels point mode and the selection controls
([collapsing](pill-and-options.md#collapsing)).

## Point mode

`components/CommentPointOverlay.tsx`. C or Add comment starts it ([keyboard](keyboard.md#shortcuts)). There is
no cover over the page:

- Presses that point at the page are taken on the window in the capture phase, before any page listener, and
  cancelled: focus, selection, drags, links, controls. Touch is not cancelled, so it scrolls. `pointsAtPage`
  decides which presses those are: outside the host, plus pins, highlights and frame shields, and on uier's own
  pages the toolbar's parts ([reviewing the toolbar](toolbar-review.md)). Only trusted presses count.
- Menus, popovers and dialogs that close on a press outside stay open. Moves still reach the page, so hover
  menus stay open too.
- Frames get transparent shields (`data-uier-shield`), since their presses go to their own document.
- It draws the outline of the element under the pointer and an add-comment pin beside a mouse or pen pointer
  (`data-uier-pointer`). The page keeps its cursor.
- The element is the topmost one whose own box holds the pointer, so a stretched link (`::after` over a row or
  card) does not hide the row's picture, summary or badges.

## Areas

- A mouse or pen drag draws an area instead (`data-uier-drawing`), also when it ends over the toolbar. The click
  that ends a drag is ignored.
- An area is saved on the innermost element that holds it, as a point at its top-left corner with
  `widthNormal`/`heightNormal` (`isCommentArea`), so older toolbars still pin it.
- `components/CommentAreaHighlight.tsx` is the dashed accent outline of a commented area (`data-uier-area`), with
  the selection tint while its thread is open. It never takes clicks: the pin opens the thread.
- Areas resolve to their rectangle in `useCommentItemRects`, so the pin sits at the bottom-right corner and the
  screenshot is the area.

## Selected text

`components/CommentSelectionPopover.tsx` is the toolbar for selected text (`role="toolbar"`, named "Selected
text"): Add comment and Rewrite ([a rewrite](composer-popovers.md#a-rewrite)). It is ink and the pill's height
(36 px buttons), with the add-comment pin and the custom rewrite icon (`RewriteIcon.tsx`: text lines and a
pencil). Its Add comment names C like the pill's ([keyboard](keyboard.md#shortcuts)).

## Tests

`apps/web/e2e/anchors.spec.ts`: pins and highlights after a reload, a scroll and a resize.
`transient-ui.spec.ts`: a modal menu, popovers, hover menus and frames (`?host-menus`).
