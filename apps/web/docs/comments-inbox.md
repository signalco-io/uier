# Comments inbox and board

- The comments page is an inbox. `comments/CommentInbox.tsx` lists compact rows (`CommentRow.tsx`: number,
  title (`commentTitle`: the [AI title](ai-titles.md), else the first line without its Markdown, `markdownPlainText`), author, page path (what it was left on is only in the thread's On row), then priority other than Normal (`PriorityLabel`: its
  flag alone, named "High priority"), status (`StateDot` and its name, Open too; a board card leaves the status to its column, whose region name screen readers announce), the assignee's avatar with their agent's mark stacked on it
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
  Move (⇄) is the keyboard and screen-reader alternative. Pointers drag, so it is visually hidden at rest (`sr-only`,
  no room taken, the drag preview has none) and shows while its card has keyboard focus (`:has(:focus-visible)`) or
  its menu is open (`data-popup-open`); screen readers always find it. Tab reaches it after the card's link, and M on
  a focused card opens it with the first column highlighted (it focuses Move and clicks it, which Base UI treats as
  a keyboard open). The link says so: `aria-keyshortcuts="M"` and the description "Press M to move it to another
  column.". After a move the focus goes to Move on the card in its new column and a status region says "Comment
  #12 moved to Done."; during a save Move stays focusable and offers no other column. The single-pointer
  alternative to dragging (and the touch path besides a long press) is the card's tap: it opens the thread, whose
  status menu has the same statuses. dnd-kit's live region announces pointer drags. Columns and both paths
  follow the `statuses` list, never fixed ids. `e2e/comment-board.spec.ts` covers mouse, touch, refused drops,
  Escape, the keyboard path (Move hidden at rest, M, Tab), In progress (to and from it, and from Ready to verify)
  and rollback; `openBoardMove` in `e2e/support/app.ts` opens Move the way a keyboard user does. What a thread was left on comes from `lib/app/commentAnchor.ts`: an element in words
  from its saved selector's tag names ("Link in navigation"), an area of one, the selected text, or the whole
  page (no page title is stored).
- Status colours: `StateDot` (`comments/CommentStatus.tsx`) gives each status its own dot, Open ink
  (`--foreground`), In progress sky (`--brand-in-progress`), Ready to verify violet (`--brand-ready`) and Done
  green (`--brand-success`; BRAND.md, "Status"), always beside the name. List rows, board column headers, the
  thread's status menu (`StateMenu`, `StateBadge`) and the Status filter (Done, the statuses under Active) all use it; the
  toolbar's `CommentStatusBadge` uses the same tokens. The dot carries `data-status-dot="<status>"`.
  `e2e/status-colors.spec.ts` checks each status's colour in the list, the board, the menu and the filter, in
  light and dark, with axe.
