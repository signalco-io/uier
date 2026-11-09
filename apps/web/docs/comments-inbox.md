# Comments inbox and board

- The comments page is an inbox. `comments/CommentInbox.tsx` lists compact rows (`CommentRow.tsx`: number,
  first line, author, page path (what it was left on is only in the thread's On row), then priority other than Normal (`PriorityLabel`: its
  flag alone, named "High priority"), status other than Open, the assignee's avatar with their agent's mark stacked on it
  (`AssigneeAvatars`), age and the unread dot) beside the open thread
  (`CommentCard.tsx`). The open thread is in the URL (`?comment=<id>`, `useOpenComment`): side by side (`@container/comments` from `@4xl`) it replaces
  the history entry and the first shown thread is open until another is chosen; narrower (a phone) a row opens
  the thread in the list's and the filters' place with Back to comments, and adds a history entry so Back closes
  it. Each row is a link (it opens in a new tab too) with the selection box beside it. The list moves with the
  keyboard like an inbox: ↓/↑ go to the next/previous row and stop at the ends, Home/End (from a row) to the first and
  last; side by side the row's thread opens through the same `open()` as a click, narrower only the focus moves and
  Enter opens it. The keys act from the list, or from the page while nothing has the focus and the caret is not in the
  open thread (it keeps scrolling with them); never from text fields, menus or dialogs, and they leave a key the page
  already handled (`defaultPrevented`). Only the current row's link and selection box are in the Tab order (a roving
  tab stop: the row last focused or opened), so Tab goes on to the thread. `e2e/comment-keyboard.spec.ts` covers it;
  the board keeps plain Tab order. `CommentBoard.tsx` shows
  Open, In progress, Ready to verify and Done as compact cards, one column per `commentStatuses` entry (keep the
  column set data-driven: that list and `commentStatusLabels`), from `lg` in one row of equal columns however many
  there are, each up to 20rem and centred beyond that. Only the board's grid is wider than the reading width (`lg:page-wide`,
  `data-page-width="wide"`); the project header, the filters, the count line, the selection bar and the empty states
  stay in the reading column, as in the list. A card opens its thread in a sheet over the board. Switching List/Board
  closes the open thread. Cards move between columns with `@dnd-kit/core`: the whole card drags (its link shows
  the grab cursor; its selection box and Move keep their presses, as Base UI opens a menu on press), with the
  mouse after 6 px or a 250 ms long press on a touch screen, so a swipe still scrolls the page (auto-scroll at
  the edges). The lifted card is a `DragOverlay` copy (`CommentRow preview`, no link id, inert) with the
  floating elevation; the original stays at 40 %. Columns carry `data-drop`: `target` (dashed) where the card
  can go, `over` (ring, a placeholder of the card's height where it lands in the list's order), `refused`
  (dimmed) where `allowedStatuses` does not allow it, `home`; while dragging every column is as tall as the
  longest. A refused drop is `cancelDrop`, and the card settles back (150 ms ease-out, none with reduced motion).
  Moves are optimistic through `useStatusChanger` (Open or In progress from Ready to verify too, which cancels
  the check and lands the card there) and roll back on failure.
  Move (⇄) is the keyboard, screen-reader and single-pointer alternative: after it the focus goes to Move on the
  card in its new column and a status region says "Comment #12 moved to Done."; during a save Move stays
  focusable and offers no other column. dnd-kit's live region announces pointer drags. Columns and both paths
  follow the `statuses` list, never fixed ids. `e2e/comment-board.spec.ts` covers mouse, touch, refused drops,
  Escape, the keyboard path, In progress (to and from it, and from Ready to verify) and rollback. What a thread was left on comes from `lib/app/commentAnchor.ts`: an element in words
  from its saved selector's tag names ("Link in navigation"), an area of one, the selected text, or the whole
  page (no page title is stored).
