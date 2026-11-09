# Comments inbox and board

- The comments page is an inbox. `comments/CommentInbox.tsx` lists compact rows (`CommentRow.tsx`: number,
  title (`commentTitle`: the [AI title](ai-titles.md), else the first line without its Markdown, `markdownPlainText`), author (`AuthorAvatar`: a member's picture or initial with the AI agent that wrote it for them
  stacked on its edge, a person's outline for a guest, uier's mark on its own starter threads; one image named "By Ana",
  the name in a tooltip, a click on it opens the row; it starts a row's meta line and a card's last line, so a card's
  path has the card's width), page path (what it was left on is only in the thread's On row), then priority other than Normal (`PriorityLabel`: its
  flag alone, named "High priority"), status (`StateDot` and its name, Open too; a board card leaves the status to its column, whose region name screen readers announce), the assignee's avatar with their agent's mark stacked on it
  (`AssigneeCard`: hovering shows who it is assigned to and their [agent](assignee-agents.md); see below), age and the unread dot) beside the open thread
  (`CommentCard.tsx`). The open thread is in the URL (`?comment=<id>`, `useOpenComment`): side by side (`@container/comments` from `@4xl`) it replaces
  the history entry and the first shown thread is open until another is chosen; narrower (a phone) a row opens
  the thread in the list's and the filters' place with Back to comments, and adds a history entry so Back closes
  it. Each row is a link (it opens in a new tab too) with the selection box beside it, quiet until it is used
  ([App triage](triage.md#selection)). The list moves with the
  keyboard like an inbox: ↓/↑ go to the next/previous row and stop at the ends, Home/End (from a row) to the first and
  last; side by side the row's thread opens through the same `open()` as a click, narrower only the focus moves and
  Enter opens it. The keys act from the list, or from the page while nothing has the focus and the caret is not in the
  open thread (it keeps scrolling with them); never from text fields, menus or dialogs, and they leave a key the page
  already handled (`defaultPrevented`). Only the current row's link and selection box (where it shows) are in the Tab order (a roving
  tab stop: the row last focused or opened), so Tab goes on to the thread. The assignee's avatars are a button above
  the row's link that follows the same tab stop (one more stop in the current row only, after the link): Enter
  opens their card, Escape gives the focus back, ↓/↑ still move between rows. A mouse click on the avatars opens the
  thread like the rest of the row (the click goes to the row's link, modifier keys too); a tap on a touch screen
  opens the card instead (44 px target), and the rest of the row opens the thread. On the board and My work, where
  Tab order is plain, assigned cards get the one extra stop; a card is not dragged from its avatars, like its other
  buttons. `e2e/comment-keyboard.spec.ts` covers the keys; the board keeps plain Tab order. `CommentBoard.tsx` shows
  Open, In progress, Ready to verify and Done as compact cards, one column per `commentStatuses` entry (keep the
  column set data-driven: that list and `commentStatusLabels`), from `lg` in one row of equal columns however many
  there are, each 18rem to 20rem and centred beyond that; when they don't fit, the board scrolls sideways
  (`data-board-scroll`, `justify-center-safe`) rather than squeezing them. On dark a card is the page's black, a step
  darker than its column, so it stands apart (light keeps paper cards on the muted column). Only the board's grid is wider than the reading width (`lg:page-wide`,
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
  column.". After a move the card travels to its new column, the focus goes to Move on it there (scrolled into view
  once it has arrived, `motionSettled`) and a status region says "Comment #12 moved to Done."; during a save Move
  stays focusable and offers no other column. The single-pointer
  alternative to dragging (and the touch path besides a long press) is the card's tap: it opens the thread, whose
  status menu has the same statuses. dnd-kit's live region announces pointer drags. Columns and both paths
  follow the `statuses` list, never fixed ids. `e2e/comment-board.spec.ts` covers mouse, touch, refused drops,
  Escape, the keyboard path (Move hidden at rest, M, Tab), In progress (to and from it, and from Ready to verify)
  and rollback; `openBoardMove` in `e2e/support/app.ts` opens Move the way a keyboard user does. What a thread was left on comes from `lib/app/commentAnchor.ts`: an element in words
  from its saved selector's tag names ("Link in navigation"), a part of uier's own toolbar by its name
  (`toolbarPartLabel` from `@uier/toolbar/feedback-context`: "Button in uier comment thread"), an area of one,
  the selected text, or the whole page (no page title is stored), with ", after opening “Comment #6”" for an
  anchor saved with an opener.
- Status colours: `StateDot` (`comments/CommentStatus.tsx`) gives each status its own dot, Open ink
  (`--foreground`), In progress sky (`--brand-in-progress`), Ready to verify violet (`--brand-ready`) and Done
  green (`--brand-success`; BRAND.md, "Status"), always beside the name. List rows, board column headers, the
  thread's status menu (`StateMenu`, `StateBadge`) and the Status filter (Done, the statuses under Active) all use it; the
  toolbar's `CommentStatusBadge` uses the same tokens. The dot carries `data-status-dot="<status>"`.
  `e2e/status-colors.spec.ts` checks each status's colour in the list, the board, the menu and the filter, in
  light and dark, with axe.

## Motion

- `comments/LayoutMotion.tsx` animates the board's cards (`data-board-card`, in the grid) and the list's rows
  (`data-comment-id`, in the list), whatever changed them: realtime and fallback refreshes, optimistic status,
  priority and assignment changes, drops, filters and search. An item that arrives fades in with an 8 px slide and one
  that leaves fades out where it was (150 ms ease-out; an `inert`, `aria-hidden` copy, since React has already removed
  it). One that changes place travels there from where it was (200 ms ease-out), and the items around it slide to
  their new places (BRAND.md, "Motion"). Only `transform` and `opacity` animate, with the Web Animations API, so input,
  focus and scroll are never held; a new update starts from where an item is on screen.
- It is FLIP in a small class component: `getSnapshotBeforeUpdate` is React's one hook that runs right before the page
  changes (the React Compiler leaves classes alone), so the first positions are exact for any kind of update. The View
  Transitions API (React 19's `<ViewTransition>`) was the alternative: it animates only transition updates (not the
  optimistic ones), snapshots the whole page and ignores input while it runs, runs one at a time, and would freeze
  dnd-kit's lifted card during a refresh. No motion library is needed.
- An item keeps its place in its own list or column: when a column shifts (the stacked board on a phone), its cards
  shift with it, and only a card that changes list travels across. Items are found by id, so a card React mounts again
  in another column is the same card. One that crosses others (another column, more than a place away) is lifted above
  them (`z-index` 11, over the cards' `z-10` controls). List rows take the card background while they move and the
  copy of a leaving row fades out beneath the rows that take its place (`data-motion:*` classes on the row, the list
  `isolate`d so neither passes over the phone's sticky header); board cards are opaque and their copies fade on top.
- No motion on the first render or a switch of List/Board (both mount), for a hidden view or tab, with
  `prefers-reduced-motion: reduce`, or when more than `motionLimit` (8) items arrive, leave or change column in one
  update: a bulk change or a filter that swaps the list snaps into place. A row folding out of the list (Done or Reopen
  from its thread, `leave`) is `inert` and needs no copy.
- The board's dragged card is dnd-kit's (`skip`: its lifted copy, `data-drag-preview`, is on screen), so the dropped
  card settles from where it was dropped and does not travel again; the placeholder still makes room with a slide.
- The keyboard focus stays on a moved item: React mounts a card again in its new column, so the same control in it
  (by id, else by position) gets the focus back without scrolling, but only when the focus was in that item and
  nothing else has taken it (React itself keeps it on a list row it only moves). Move keeps its own focus handling;
  announcements are unchanged.
- An item carries `data-motion="enter"` or `"move"` while it moves; a leaving copy has `data-motion="exit"` and
  `data-motion-for`. `e2e/comment-motion.spec.ts` watches for them (never for timing): a status change through the
  thread, a realtime arrival, search, a drop, a priority change, the bulk limit, reduced motion and focus.
