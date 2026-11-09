# Comments inbox and board

- The comments page is an inbox. `comments/CommentInbox.tsx` lists compact rows (`CommentRow.tsx`). The title line:
  the unread dot, the author (`AuthorAvatar`: a member's picture or initial with the AI agent that wrote it for them
  stacked on its edge, a person's outline for a guest, uier's mark on its own starter threads; one image named "By Ana",
  the name in a tooltip, a click on it opens the row; it starts the line, before the number, centred on a card's
  first title line), number, title (`commentTitle`: the [AI title](ai-titles.md), else the first line without its Markdown, `markdownPlainText`; up to two lines on a card)
  and age (`RelativeTime short`: "3 min ago", "2 hr ago", "yesterday", "2 wk ago", the date and time on hover; the
  thread's messages, its activity and other sentences keep whole words; one shared clock ticks every 10 seconds while any age is shown and the tab is visible, and only the ages whose words change re-render).
  The meta line, one on rows and cards alike, starts under the title, so the path lines up with "#12 …": the selection
  box under the author's avatar (past the unread dot's room), the page path (what it was left on is only in the thread's On row), then private, a linked pull request, priority other than Normal (`PriorityLabel`: its
  flag alone, named "High priority"), status (`StateDot` and its name, Open too; a board card leaves the status to its column, whose region name screen readers announce), and at its right end
  every assignee's avatar with their agents' smaller avatars stacked beside it (`AssigneeCard`: hovering shows who it is assigned to
  and their [agents](assignee-agents.md); see [Multiple assignees](#multiple-assignees)), beside the open thread
  (`CommentCard.tsx`). The open thread is in the URL (`?comment=<id>`, `useOpenComment`): side by side (`@container/comments` from `@3xl`, 48rem: the list's 18rem and
  at least 29rem for the thread; from about 1100 px with the sidebar docked, which takes in most landscape tablets) it replaces
  the history entry and the first shown thread is open until another is chosen; narrower (a phone, a tablet in portrait) a row opens
  the thread in the list's and the filters' place with Back to comments, and adds a history entry so Back closes
  it. Where the page scrolls (below `lg`) the thread opens and stays (beside the list) under the sticky top bar. Each row is a link (it opens in a new tab too); its selection box starts the meta line under the author (a
  card's bottom left) and shows only when it is used ([App triage](triage.md#selection)), but keeps its room (and the
  room stays where a person can't triage), so the path never moves when it appears. The list moves with the
  keyboard like an inbox: ↓/↑ go to the next/previous row and stop at the ends, Home/End (from a row) to the first and
  last; side by side the row's thread opens through the same `open()` as a click, narrower only the focus moves and
  Enter opens it. The keys act from the list, or from the page while nothing has the focus and the caret is not in the
  open thread (it keeps scrolling with them); never from text fields, menus or dialogs, and they leave a key the page
  already handled (`defaultPrevented`). J and K do what ↓ and ↑ do from anywhere else too, the open thread included,
  and where the thread has taken the list's place (a phone) they open the next or the previous thread there (the
  history entry is replaced, so Back still closes it). R, S and A reply, open the status menu and the assignee menu
  of the thread on screen ([keyboard](keyboard.md)). Only the current row's link and selection box (where it shows) are in the Tab order (a roving
  tab stop: the row last focused or opened), so Tab goes on to the thread. The assignee's avatars are a button above
  the row's link that follows the same tab stop (one more stop in the current row only, after the link and the selection box): Enter
  opens their card, Escape gives the focus back, ↓/↑ still move between rows. A mouse click on the avatars opens the
  thread like the rest of the row (the click goes to the row's link, modifier keys too); a tap on a touch screen
  opens the card instead (44 px target), and the rest of the row opens the thread. The board and My work have the same
  roving tab stop (the card or row last focused, else the open one, else the first), so their avatars are the one
  extra stop of the current card or row; a card is not dragged from its avatars, like its other buttons. On the board
  ↓ and ↑ move in a column, ← and → to the card in the same place in the next column with cards (or its last), Home
  and End to the column's first and last; J and K go through the cards column by column, and with a thread open in
  the sheet they open the next one there. `e2e/comment-keyboard.spec.ts` covers the list's keys,
  `e2e/app-keyboard.spec.ts` the board's and My work's. `CommentBoard.tsx` shows
  Open, In progress, Ready to verify and Done as compact cards, one column per `commentStatuses` entry (keep the
  column set data-driven: that list and `commentStatusLabels`), from `md` (tablets too) in one row of equal columns however many
  there are, each 18rem to 20rem and centred beyond that; when they don't fit, the board scrolls sideways
  (`data-board-scroll`, `justify-center-safe`; a swipe on a touch screen) rather than squeezing them. The scroller runs
  edge to edge of the panel, padded by the page gutter (`page-bleed`, `--page-gutter`), so the first and last columns
  line up with the page content at either end and the others scroll under the panel's edges, not short of them. A phone stacks them. On dark a card is the page's black, a step
  darker than its column, so it stands apart (light keeps paper cards on the muted column). Only the board's grid is wider than the reading width (`md:page-bleed`,
  `data-page-width="wide"`); the project header, the filters, the count line, the selection bar and the empty states
  stay in the reading column, as in the list. An empty column's line ("Nothing open.", "Drop here." while
  dragging, `data-empty-column`) fills the room below the column's name and sits in its middle. A card opens its thread in a sheet over the board. Switching List/Board
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
  its menu is open (`data-popup-open`); screen readers always find it. Tab reaches it after the current card's link, and M on
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
  thread's status menu (`StateMenu`, `StateBadge`) and the Active statuses menu of the Status filter all use it (the status tabs have none); the
  toolbar's `CommentStatusBadge` uses the same tokens. The dot carries `data-status-dot="<status>"`.
  `e2e/status-colors.spec.ts` checks each status's colour in the list, the board, the menu and the filter, in
  light and dark, with axe. It opens the board's Move through `openBoardMove`, as a keyboard user does,
  rather than clicking its visually hidden pointer target.

The touch drag test centres its source card in the viewport before the long press so edge auto-scroll
does not invalidate the captured drop coordinates as card heights change.

The list and active board columns sort by priority, then newest number. Done sorts by the last
transition into Done (`completedAt`), newest first, regardless of priority or number. Legacy Done
threads fall back to `updatedAt`, then `createdAt`; ties use the usual list order. Ordinary Done
writes and verification confirmations record completion; same-status writes and later replies
preserve it. Reopening and completing again records a new time. Optimistic moves place the card
first in Done (in its default sort, [below](#board-column-sorts)), including the drag placeholder; realtime snapshots use the persisted time and the
existing layout motion.

Rows and board cards show one small outlined pull request mark, named "Linked pull request", when a
current message or reply links to a supported provider PR. It is `PullRequestCard` (`ThreadPullRequests.tsx`),
which works like the assignee card: hovering it, Enter on it (it shares the row's tab stop rule) or a tap
opens a popover listing each pull request with its provider's mark, repository and number as an external link,
and its state badge when known; a mouse click still opens the thread. State is read only while the popover is
open, through the same endpoint and five-minute reuse as the [open thread's details](comment-thread.md).
Provider titles are never read, so none shows. Rows without a project id and the board's drag preview keep the plain mark.
`CommentRow` uses the browser-safe `lib/comments/pullRequestLinks.ts` recognizer for both layouts,
including My work and the board's drag preview. Deleted messages lose their links; an edited or newly
saved reply updates the mark through the existing comment refresh.

## Board column sorts

The orders above are the board's defaults. Each column can have its own sort instead, saved on the project
(`DbProject.boardSorts`), so everyone who opens that project's board sees the same order: not per
browser or person, and not one setting for every project. `lib/app/boardSort.ts` (browser-safe) has
the choices: active columns offer Priority (default, `compareCommentOrder`), Newest first and Oldest
first (`createdAt`, then number) and Recently updated (`updatedAt`, then the usual order); Done offers
Recently completed (default, `compareDoneOrder`) and the same four. Only choices other than a column's
default are stored, and a stored value a column does not offer reads as its default (`boardSort`).
The list view keeps its order.

- `BoardSortMenu` ends each column's header: a ghost icon button (`ArrowUpDownIcon`, named
  "Sort Open: Priority") with the UI kit's radio menu, which closes on a choice. A column in another
  order than its default shows the sort's short name beside the icon ("Newest"), so the shared order is
  visible. It takes no more height than the column's name, and 44 px to tap on a touch screen.
- Who: the people who triage the project (`canSortProjectBoard` = `canTriageProject`), who also move
  its cards: every member, but on uier's own feedback projects only their staff (accounts there see
  only their own threads). Others get no menu. `setBoardSortAction` parses the column and the choice
  (`boardSortActionSchema`), loads the project with the visible-project check, and
  `saveProjectBoardSort` checks the column's choices and the person again before it writes the project
  document (`updateDoc`, one point read and replace). Unlike `updateProject` it takes uier's feedback
  projects too: it is how their board reads, not a setting uier manages. The page revalidates; a choice
  shows at once (`useOptimistic`) and goes back with an error toast if saving fails, with no success
  toast. Open boards elsewhere pick it up on their next load.
- `ProjectComments` sorts each column (`sortBoardColumn`, ties in the list's order), so everything that
  reads the columns follows the chosen order: the arrow keys, J and K and the selection's ranges. A move shows the card as it will be (`movedPatch`: the new status, Done's completion time and
  the update time the server gives every change), so Move and a drop land it in its place in the new
  column's sort, and the drag placeholder sits where it will land (the column's cards with the moved one,
  in the list's order, then sorted).
- `e2e/board-sort.api.spec.ts` covers each sort, the column choices, validation, saving and resetting,
  commenters, guests and uier's user feedback project (staff only, kept by provisioning).
  `e2e/comment-order.spec.ts` (full suite) chooses sorts from the header, checks the keys, Move and a
  drop's placeholder against them, a reload and a teammate's board.

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
  `isolate`d so neither passes over the sticky top bar where the page scrolls); board cards are opaque and their copies fade on top.
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


## Multiple assignees

Rows, board cards and My work use `commentAssignees` (arrays with a singular fallback), and
`AssigneeCard` groups every person's agents with that person: smaller avatars stacked beside theirs,
and smaller, indented agent rows under their name in the hover card, on a line centred under their avatar. Counts keep larger groups compact;
the card scrolls to show everyone. The thread's `AssigneesControl`
checkbox menu stays open to select several people; toggling uses atomic add/remove, while Unassign
clears everyone. Only your own assignment exposes editable `AgentControl` instances. Assigned to me
matches any person in the assignment; Unassigned means the array is empty. My work includes a thread
once even when several people are assigned. Realtime refreshes reuse the authorized snapshot and
keep open composers and drafts. The same shared row renders in My work. `multiple-assignees.spec.ts`
covers both themes on desktop/mobile, app/toolbar assignment, agents, filters, My work and realtime.
