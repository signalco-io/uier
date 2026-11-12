# Comments inbox and board

`e2e/project-review.spec.ts` checks the row's author through the avatar's accessible name and
the page path separately, so layout changes keep both pieces of information covered. After restoring
rows with the status filter it waits for their entrance motion to settle before scanning contrast.

- The comments page is an inbox. `comments/CommentInbox.tsx` lists compact rows (`CommentRow.tsx`). The title line:
  the author (`AuthorAvatar`: a member's picture or initial with the AI agent that wrote it for them
  stacked on its edge, a person's outline for a guest, uier's mark on its own starter threads; one image named "By Ana",
  the name in a tooltip, a click on it opens the row; it starts the line, before the number, centred on a card's
  first title line), number, title (`commentTitle`: the [AI title](ai-titles.md), else the first line without its Markdown, `markdownPlainText`; up to two lines on a card)
  and age (`RelativeTime short`: "3 min ago", "2 hr ago", "yesterday", "2 wk ago", the date and time on hover; the
  thread's messages, its activity and other sentences keep whole words; one shared clock ticks every 10 seconds while any age is shown and the tab is visible, and only the ages whose words change re-render). The first minute reads "just now", here and in the toolbar's thread (`CommentTime`), never counting seconds (uier #172).
  The unread dot overlays the row's top right corner, above the age (out of the flow, so reading a row moves nothing,
  uier #330, #360), and the row's padding is the same on both sides (`px-3`, uier #354).
  The meta line, one on rows and cards alike, starts under the title, so the path lines up with "#12 …": the selection
  box under the author's avatar, the page path (what it was left on is only in the thread's On row), then private (a 12 px lock, a step smaller than the other marks), a linked pull request, priority other than Normal (`PriorityLabel`: its
  flag alone, named "High priority"), status (`StateDot` and its name, Open too; a board card leaves the status to its column, whose region name screen readers announce), and at its right end
  every assignee's avatar with their agents' smaller avatars stacked beside it (`AssigneeCard`: hovering shows who it is assigned to
  and their [agents](assignee-agents.md); see [Multiple assignees](#multiple-assignees)), beside the open thread
  (`CommentCard.tsx`). The open thread is in the URL (`?comment=<id>`, `useOpenComment`): side by side (`@container/comments` from `@3xl`, 48rem: the list's 18rem and
  at least 29rem for the thread; from about 1100 px with the sidebar docked, which takes in most landscape tablets; the
  list and the thread then break out of the reading column to the panel's width, at most 96rem, with `page-wide`'s length
  ([app shell](app-shell.md)), the list taking up to 30 % of it, 28rem at most; the filters' header (search, Filter, List/Board, the status tabs and the filters in effect) and the project header above it take the same width, `ProjectComments`) it replaces
  the history entry and the first shown thread is open until another is chosen (it stays while it is listed, so a thread
  that arrives above it in a realtime refresh does not take its place, and the arrow keys go on from it; a filter that
  hides it shows the new first one; `e2e/realtime.spec.ts`); narrower (a phone, a tablet in portrait) a row opens
  the thread in the list's and the filters' place with Back to comments, and adds a history entry so Back closes
  it. Where the page scrolls (below `lg`) the thread opens and stays (beside the list) under the sticky top bar. Stuck beside the list it keeps the page gutter (`--page-gutter`) above and below it, the gap it has from the panel's side ([uier #312](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_kETWRM4lFAX9IoRqOG2vY)). Each row is a link (it opens in a new tab too); its selection box starts the meta line under the author (a
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
  the row's link that follows the same tab stop (one more stop in the current row only, after the link and the selection box). These
  buttons repeat on every row, so their names end with the row's thread: "Assigned to you, with Claude, comment #12"
  (`CommentRow`'s `subject`; My work adds "in <project>", and a thread without a number uses its quoted title). Enter
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
  column set data-driven: that list and `commentStatusLabels`), then Archive, collapsed unless expanded
  ([Board archive column](#board-archive-column)), in one row of equal columns however many there are, on phones and
  tablets too, each 18rem to 20rem (on a phone at most the page's width less 3rem, so the next column peeks in at the
  edge, [uier #305](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_Lnt-zHIL2JcwH6VBeik9Y)) and centred beyond that; when they don't fit, the board scrolls sideways
  (`data-board-scroll`, `justify-center-safe`; a swipe on a touch screen) rather than squeezing them. The scroller runs
  edge to edge of the panel, padded by the page gutter (`page-bleed`, `--page-gutter`), so the first and last columns
  line up with the page content at either end and the others scroll under the panel's edges, not short of them. Where
  the columns fit there is no scrollbar, scrollbars that take room included (the panel's width is measured inside its
  scrollbar, [app shell](app-shell.md)). On dark a card is the page's black, a step
  darker than its column, so it stands apart (light keeps paper cards on the muted column). The board's grid is wider than the reading width (`md:page-bleed`,
  `data-page-width="wide"`), and from `md` the filters' header takes the columns' width (`--board-width`: 20rem a
  column and the gaps, never narrower than the reading column), up to the panel's width less the gutters
  (`page-wide`): when the columns don't fit, the header stays at that width while the board scrolls under it. The
  project header (its mark, name, access label, Open review and Settings) takes the same width as the filters' header,
  in the list and on the board (uier #168: the filters' header carries `data-header-wide`, and the project layout widens
  its `PageHeader` from it with `group-has-*`, so settings and the install guide keep the reading width). The count line
  under the filters (in the search row where there is room, uier #300) takes that width too (uier #187: `TriageSelection`'s `lineClassName`, the header's width classes);
  the selection bar and the empty states stay in the reading column. An empty column's line ("Nothing open.", "Drop here." while
  dragging, `data-empty-column`) fills the room below the column's name and sits in its middle. A card opens its thread in a sheet over the board; the sheet scrolls the thread, which keeps its full height there (`shrink-0`: the card clips, so as the sheet's flex item it would shrink to the sheet and hide everything below the fold, [uier #201](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_UlwxhOaVoQ87SKArMx3B-); `e2e/comment-board.spec.ts` scrolls a long thread on a short window). Switching List/Board
  closes the open thread. The choice (the toggle, or G then I or B) is kept in the address, `?view=list` too, and
  remembered in this browser for every project (`commentsView.ts`, `localStorage`; blocked storage only loses the
  memory; My work remembers its own, [app shell](app-shell.md)). With no view in the address the remembered one opens and is written there in a layout effect: a page reached
  in the app paints in it, a full load shows the server's list for a moment. A view in the address wins and is not
  remembered ([uier #291](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_d_oxAs9XP_GuQOZ0l9NND); `e2e/comment-board.spec.ts`). Cards move between columns with `@dnd-kit/core`: the whole card drags (its link shows
  the grab cursor; its selection box and Move keep their presses, as Base UI opens a menu on press), with the
  mouse after 6 px; on a touch screen a card held 250 ms is armed (`data-hold`) and lifts when the finger then moves more
  than 10 px (`HoldTouchSensor`), so a swipe still scrolls the page and a long press held still (600 ms) selects the card
  instead ([App triage](triage.md#selection)); a dragged card auto-scrolls at
  the edges. The lifted card is a `DragOverlay` copy (`CommentRow preview`, no link id, inert) with the
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
  alternative to dragging (and the touch path besides holding and moving) is the card's tap: it opens the thread, whose
  status menu has the same statuses. dnd-kit's live region announces pointer drags. Columns and both paths
  follow the `statuses` list, never fixed ids. `e2e/comment-board.spec.ts` covers mouse, touch, refused drops,
  Escape, the keyboard path (Move hidden at rest, M, Tab), In progress (to and from it, and from Ready to verify)
  and rollback; `openBoardMove` in `e2e/support/app.ts` opens Move the way a keyboard user does. What a thread was left on comes from `lib/app/commentAnchor.ts`: an element in words
  from its saved selector's tag names ("Link in navigation"), a part of uier's own toolbar by its name
  (`toolbarPartLabel` from `@uier/toolbar/feedback-context`: "Button in uier comment thread"), an area of one,
  the selected text, or the whole page (no page title is stored), with ", after opening “Comment #6”" for an
  anchor saved with an opener.
- Status colours: `StateDot` (`comments/CommentStatus.tsx`) gives each status its own dot, Open an outlined ink
  ring (`--foreground`, not filled), In progress sky (`--brand-in-progress`), Ready to verify violet (`--brand-ready`) and Done
  green (`--brand-success`; BRAND.md, "Status"), always beside the name. List rows, board column headers, the
  thread's status menu (`StateMenu`, `StateBadge`) and the Active statuses menu of the Status filter all use it (the status tabs have none); the
  toolbar's `CommentStatusBadge` uses the same tokens. The dot carries `data-status-dot="<status>"`.
  `e2e/status-colors.spec.ts` checks each status's colour in the list, the board, the menu and the filter, in
  light and dark, with axe. It opens the board's Move through `openBoardMove`, as a keyboard user does,
  rather than clicking its visually hidden pointer target.

The touch drag test centres its source card in the viewport before the hold so edge auto-scroll
does not invalidate the captured drop coordinates as card heights change. It moves the finger as soon as the card is
armed (`heldForDrag`), before the long press would select it.

The list and active board columns sort by priority, then newest number. Done sorts by the last
transition into Done (`completedAt`), newest first, regardless of priority or number. Legacy Done
threads fall back to `updatedAt`, then `createdAt`; ties use the usual list order. Ordinary Done
writes and verification confirmations record completion; same-status writes and later replies
preserve it. Reopening and completing again records a new time. Optimistic moves place the card
first in Done (in its default sort, [below](#board-column-sorts)), including the drag placeholder; realtime snapshots use the persisted time and the
existing layout motion.

Rows and board cards show one small outlined pull request mark, named "Linked pull request, comment #12", when a
current message or reply links to a supported provider PR. It is `PullRequestCard` (`ThreadPullRequests.tsx`),
which works like the assignee card: hovering it, Enter on it (it shares the row's tab stop rule) or a tap
opens a popover listing each pull request with its provider's mark, repository and number as an external link,
and its state badge when known (the name in the state's colour, but a closed one's in ink); a mouse click still opens the thread. The mark takes the
state's colour (`data-pull-request-color`) when every one of the thread's pull requests is in the same known state,
from a read the page already made (the open thread beside it, or the mark's card; a shared store in
`ThreadPullRequests.tsx`): rows never read on their own, so a list doesn't spend the providers' hourly reads. State is read only while the popover is
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
Recently completed (default, `compareDoneOrder`) and the same four; Archive ([below](#board-archive-column))
offers Recently archived (default, `compareArchivedOrder`) and the same four, saved under `archive`. Only choices other than a column's
default are stored, and a stored value a column does not offer reads as its default (`boardSort`).
The list view keeps its order.
The write schema lives separately in `boardSortSchema.ts`, so reading the browser's choices and
defaults does not initialize Zod. Actions and persistence use that same schema before writing.

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


### Idle snapshot checks

`RealtimeComments` receives the revision of the server snapshot shown by `ProjectComments`.
Ready/foreground and periodic safety signals compare it with the same authorized view on the server
before a full refresh. Unchanged views preserve the existing shell, selected thread, composers,
focus and optimistic updates. Actual socket changes still refresh immediately. The next baseline
always comes from the completed page render, not the earlier check. Session/access loss and failed
checks use the normal server page to reconcile. Hidden/offline views never refresh from late check
responses. A full five-minute shell safety refresh keeps unrelated sidebar changes bounded;
[app shell](app-shell.md#idle-comments-refreshes) describes the cost and freshness tradeoff.
The fingerprint includes the effective label catalog once at snapshot level and omits each
comment's duplicate `availableLabels`, like its duplicate `workflow`. Per-thread labels and IDs
still detect assignment changes; catalog edits still change the snapshot revision.

## Archive

Archive is an explicit list scope (`?status=archived`), separate from Active, Done and All; it is chosen from the
"Done and archive" menu beside the Done tab, which then reads "Archive" ([comment filters](comment-filters.md)). The
ordinary tabs, workflow board columns and My work exclude archived threads. On the board, Archive is
the last column, after Done ([below](#board-archive-column)); `?status=archived` with Board shows the
list's Archive, and choosing Board from there returns to the columns.
Counts follow the selected search, people, page, priority, environment and author scopes. The project app pages ordinary and archive columns independently by effective status ID, with exact
server totals. Collapsed archive columns load counts without rows. My work retains its ordinary
window. Project presentation filters now query the complete authorized scope; see [paged project comments](#paged-project-comments).
An archived or restored open thread leaves its previous scope, including its detail panel.

More actions → Archive comment moves a thread into Archive; Restore comment returns it to its prior
workflow status, including Done or Ready to verify. Both changes are optimistic and roll back on
failure; they do not delete content or mark it read. The archive detail carries an Archived label.
The toolbar uses the same actions in Thread options and Archive under its Done tab; archived threads have no pins,
highlights, inline slots or Show on page action until restored. `e2e/archive.spec.ts` covers both
surfaces, reload, restore, failed saves, mobile and light/dark accessibility.

### Board archive column

[uier #243](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_ell0Rb7O9hDp71RsDToUS):
`ArchiveColumn` in `CommentBoard.tsx` comes after the status columns, collapsed by default: a 3rem strip
only as tall as its content (from `md` its icon, name and count run down it as one turned group, a full-width row on
a phone) that is one button, "Archive 3", with
`aria-expanded`. Expanded, it is a column like the others (18rem to 20rem) whose header ends with
Collapse Archive (`FoldHorizontalIcon`, a tooltip); the focus moves to the other toggle either way. The grid's
tracks come from `--board-columns` (the statuses, then the strip or a column), and the project layout widens its
header from the section's `data-board-archive` (`--board-width-collapsed` / `--board-width-expanded`).
- Order: by default like Done but by archive time (`compareArchivedOrder`: `archivedAt`, newest first, then the update and
  creation times, ties in the list's order). [uier #251](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_isE8wcqHfUDuHHI3xdXB9):
  its expanded header has a sort menu like Done's (Recently archived instead of Recently completed), before Collapse
  Archive, saved on the project like the other columns' sorts (`boardSorts.archive`, the same people and action).
- Its cards open their thread in the sheet like the others (the board's scope includes archived threads, so
  archiving from the sheet keeps it open with the Archived label) but don't drag and have no Move; Restore comment
  returns one to its column. It is not a drop target and is dimmed (`data-drop="refused"`) while a card is dragged.
  While expanded its cards are in the keys' lanes (← → reach it, J and K go through it) and in the selection.
- Expanded is saved on the project (`DbProject.boardArchiveExpanded`, missing when collapsed), like the sorts:
  everyone who opens the board sees it, and the same people change it (`saveProjectBoardArchive`,
  `setBoardArchiveAction`, `canSortProjectBoard`), optimistically with an error toast. Others can still expand it
  for themselves until the page is opened again. The action schema and `saveProjectBoardArchive` both accept only
  a boolean, so a string such as `"false"` or `null` is refused before any write.
- `e2e/archive.spec.ts` covers collapsed and expanded, archiving and restoring from the board, its sort, the focus, a reload
  and light/dark axe; `e2e/board-sort.api.spec.ts` the order, the saved state and invalid inputs; `e2e/comment-board.spec.ts` its
  place in the layout and during a drag.

The Board stays directly imported by `ProjectComments`, so direct Board visits hydrate its
keyboard controls with the rest of the view.

### Layout stability

The populated inbox keeps `data-page-width="wide"` on its outer container and derives the header's
width from the chosen view, even when presentation filters match nothing. Removing the board must
not remove the shell's width container or recenter the search and project header. The unread/action
row reserves 32 px (44 px on touch) throughout a populated inbox's lifetime, including when empty,
where the comments are narrower than 56rem; wider, it is in the search row left of Filter, where it adds
no row and its appearing or going away moves nothing else ([comment filters](comment-filters.md)), and
the reserved row is hidden. Live arrivals and reading the last unread thread cannot move the comments. A row's unread dot sits
in its left padding, out of the flow, so reading it leaves its title and path where they are.

`e2e/project-cls.spec.ts` measures production HTML through delayed hydration at the reported desktop
viewport (1674 × 1366) and on Mobile Chrome, with 20 API-created threads and 4× CPU slowdown. It
records every `layout-shift` source and before/after rectangle in `project-cls.json`, with the toolbar's
largest-session-window calculation (recent input and toolbar-only entries excluded). It checks the
painted view before releasing scripts, read-all, a background unread arrival, an empty search and
Give feedback's toolbar injection, plus unchanged board/header geometry, the count line left of Filter on
desktop (under it on a phone) and Filter staying put through read-all and the arrival. The full report and limits
are in [the CLS investigation](project-comments-cls.md).

### My work's board

`CommentBoard` takes each card's project (`projectOf`: id, name, people to assign) instead of one project id, and
`archive` is optional. A project's board passes its own project for every card; My work (`MyWorkBoard`, [uier #294](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fmy-work&comment=comment_UFce1oOdSATj5MRS9lRNt))
passes each thread's, so the card names its project, a move is saved in that project with the thread's own permissions,
and the sheet opens the thread with that project's people. My work has no Archive column; its columns' sort menus change
My work's own sorts, not a project's (`onSort` from `MyWorkBoard`, remembered in the browser). The List/Board toggle is one
component (`CommentsViewToggle`) in both places, in `CommentFilters`' row (My work passes `onView` to remember its own).
Cards and rows of several projects show the project's icon before its name (`BoardProject`'s `url`, `CommentRow`'s `projectUrl`). See [app shell](app-shell.md) for what My work's board shows.

## App language

The app's selected language applies to the inbox, board, filters, thread controls and their
accessible names. `src/lib/i18n/catalogs/comments` holds the six complete catalogs. Shared machine
values and browser-safe label records stay stable; components translate their display labels.
Custom feedback type names, comments, project names and other member content remain as written.
Relative times use the app language and the existing shared clock.

## Custom status columns

Project boards resolve the workspace status workflow or project override. Each ordinary status
gets a column in its category's order; each archive status gets a collapsed/expanded archive
column, sharing the project's archive expansion choice. Column IDs are status IDs, labels and
descriptions come from settings, and dots/permissions/sorts continue to use the category. Existing
card spacing and content stay shared with the inbox. Move, drag targets, keyboard lanes and the
placeholder follow those IDs. Within-category moves retain completion times and verification.
A move into Ready to verify opens the existing request form with that destination ID; canceling a
pending check into a custom Open/In progress status is one conditional write. Archive menus offer
the configured shortcut and explicit archive destinations; restore retains the ordinary custom ID.
Rows and threads show custom labels; built-in labels retain localization. The board test helper
reveals and settles an offscreen card before keyboard-opening Move, so horizontal scrolling
from a previous move cannot anchor its menu outside a mobile viewport. My work keeps category
lanes, with project-specific status choices in each thread. See [custom status settings](project-settings.md#custom-statuses).

## Thread labels

App thread details show Labels after Priority. People who can triage can use Edit labels to add
or remove one from the effective catalog; the menu includes descriptions, checked selections and
the configured brand color/icon. At most 20 labels per thread. Rows and board cards show the
current names as bordered badges. Names and descriptions are untrusted text, never markup.
The same badges appear in My work. No success toast for the in-place change; failures show an error.

`review/threadLabels.ts` performs atomic add/remove under the current comment ETag, rechecking
project membership, visibility and the current catalog on every write attempt. It uses triage
permission (members; staff only on uier feedback projects), advances activity and records one
label-change history entry, without sending email or changing status/verification/assignments.
No-op calls preserve comment activity/history. Receipts retain the usual actor/partition/key
scope and replay without overwriting later edits, even if a definition was removed. New adds
reject foreign/removed IDs; removing can clear a retired ID. New adds prune retired IDs so they
cannot consume all available slots. Existing guest DTOs and exports omit labels.

This slice leaves board columns and their paging unchanged. Label swim lanes and their saved
project setting, plus toolbar label controls, are deferred.

## Paged project comments

Project Board and List request 25 summaries at a time (`projectCommentPages.ts`,
`POST /api/projects/:projectId/comments/pages`). Board starts one page per effective ordinary status,
in category order. Custom status IDs have independent cursors and totals; missing/removed stored IDs
fall back through `statusForComment` to the category default. Default statuses retain their columns; Ready to verify is only shown when the project enables verification.
Each archive status has a total while collapsed and gets its first page when expanded. The list has
one cursor for the selected status scope. Sorts retain their category settings, completion/archive
fallbacks, missing-value rules and deterministic ID ties.

Search (including replies and quotes), people, page/section, priority, labels, unread, environment and author
apply before page selection. Tabs/column headers and page options come from complete authorized
server matches, independent of the loaded window. Per-status unread totals also cover unloaded pages, with the same optimistic read deltas as counts. The recent 1,000-thread search cap no longer
applies to project Board/List. Signed cursors expire after 15 minutes and bind the project, viewer,
query, effective workflow, view and sort. Every request reauthorizes current workspace/project access
and private visibility; cursors never grant access. Responses are private/no-store and cross-site
browser reads are rejected.

The scroll sentinel and the keyboard-accessible Load more button share one request per column.
Failures keep the current rows, explain what failed and offer Try again; an expired cursor restarts
the loaded window. Failed filters release `aria-busy`, so assistive technology can announce the
retry message. An execution-budget failure on the server-rendered page keeps the environment and
author controls available with a narrowing message; it never presents partial totals. HTTP requests
retain their 422 error.
`VirtualCommentList` measures variable-height rows and renders the viewport with overscan; spacer
items cannot shrink. Focused/dragged cards stay mounted, and keyboard navigation reveals its target
before focusing it. Each column scrolls vertically within the existing horizontal board. List rows
use document/window virtualization below 1024 px, with no nested list scroll box. Horizontal clipping prevents visually hidden inline labels after long titles from extending the document viewport; wider lists retain a bounded scroller. Rows expose their absolute `aria-posinset` and the server total as `aria-setsize`. My work retains its existing data source and category lanes.

Selection and Select shown results use the explicitly loaded matching summaries (up to the existing
50-thread batch limit), including loaded rows outside the virtual viewport. Fetching another page or
a realtime arrival never extends a selection. Counts describe all matches; Mark shown as read acts
on loaded unread rows while more unread matches exist, and Mark all as read remains when all are loaded.
Summaries omit replies, screenshots, reproduction details and history. Opening a thread loads its
fresh canonical detail; a deep link outside the first page works independently. A board sheet remains
open when its thread moves into a collapsed archive column. Details/composers keep their identity
through fresh snapshots; deleted/inaccessible details close on a fresh 404.

Filter changes keep URL/history controls immediate, cancel stale page requests and replace the window.
Socket/action refreshes send one `depths` map and rebuild all loaded lanes from a single scan,
capped at eight pages (200 rows) per lane. A fresh RSC first page can be reused until deeper pages
are loaded; deeper refreshes need one additional HTTP request, rather than one request per page.
Loading another page preserves the full-window revision baseline, so a router refresh with that page response’s revision still rebuilds every loaded lane.
Scroll and composers remain mounted while moved/deleted rows leave. Enrichment reuses the scan
request’s read cursors and subscriptions; a thread becoming private between scan and canonical
read is skipped. Idle revision checks use routing metadata without
canonical detail enrichment. No private application data is put in a shared cache.

### Measurement and remaining database work

`project-paging-benchmark.api.spec.ts` seeds 2,000 threads with 11 messages each and measures five
in-process snapshot loads. The baseline is the previous full-thread loader at
`b354414442b9653ab9c48da72bdaf0f49865b577`: it returned 1,400 views (1,000 ordinary plus 400 archived),
so its ordinary window also omitted 600 threads. The new snapshot counts all 2,000, returns 100 board
summaries or 25 list summaries, and leaves the collapsed archive bodies unloaded. The fixture enables verification so its four ordinary status lanes remain comparable after #687.

| In-process snapshot, 2,000 × 11 messages | Before | After |
| --- | ---: | ---: |
| Board JSON | 25,105,338 B | 233,625 B |
| List JSON | 25,105,337 B | 60,843 B |
| Board median of five | 80.24 ms | 29.46 ms |
| List median of five | 76.81 ms | 22.75 ms |

These are serialized snapshot bytes and local in-memory service timings, not deployed HTTP latency,
compressed transfer or Cosmos RU. `project-paging-load.spec.ts` separately records production-build
HTML bytes, DOM size, mounted rows and hydration time with 2,000 real API-created single-message
threads. `project-comment-page-routes.api.spec.ts` covers the HTTP authorization, origin, schema, depths and cursor boundaries against the running server, with HTTP-provisioned fixtures and server-minted session cookies; it needs no browser or imported Next.js request scope. `project-comment-paging.spec.ts` and the shared tablet journey check refresh batching, off-page unread dots, scroll/retry/selection/search/detail behavior on
desktop, mobile and tablet. Timing targets still need deployed measurements.

The browser baseline is `10a39b764cba91a178fc9ee24e532cf3afda0f24` (merged custom statuses and
board filters, before this change), Chromium 158.0.8127.18, Desktop Chrome, ordinary production
builds, no CPU slowdown. The same fixture and navigation run on the changed build. These are one
run per view, not latency percentiles:

| Initial desktop document, 2,000 × 1 message | Before | After |
| --- | ---: | ---: |
| Board mounted rows | 1,000 | 10 |
| List mounted rows | 1,000 | 10 |
| Board DOM elements | 38,371 | 741 |
| List DOM elements | 35,424 | 783 |
| Board decoded HTML | 11,263,172 B | 295,774 B |
| List decoded HTML | 9,742,889 B | 281,926 B |
| Board encoded HTML | 278,983 B | 37,806 B |
| List encoded HTML | 254,401 B | 36,964 B |
| Board through hydration | 2,123 ms | 430 ms |
| List through hydration | 1,539 ms | 418 ms |

Mobile Chrome mounted 10 board rows and 16 document-scrolling list rows, with 25 loaded in either view and totals of 2,000. The list kept the document at 393 px with no horizontal overflow. The regression checks the first loaded window as well as mounted rows, so an eager sentinel cannot hide behind virtualization.
`project-paging-load.json` records each profile's HTML, DOM, FCP and hydration measurements. Run
`PORT=4504 PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test project-paging-load.spec.ts --project="Desktop Chrome" --project="Mobile Chrome" --retries=0`
after a production build. For a parent comparison, run the same fixture on that build with
`UIER_PAGING_BASELINE=1`; that flag only relaxes this test's new-behavior assertions and has no
application/runtime behavior. No production settings or data were changed.


The database source performs one bounded projection scan per request, not one scan per column.
Unfiltered routing reads omit message text, quotes, metadata search text and diagnostics; canonical
reads/enrichment run only for selected summaries (fanout eight). Text search explicitly includes
message bodies for complete matching. The existing 100,000-candidate/32 MiB/10,000 RU/five-second
scan budgets still apply and fail explicitly rather than returning partial totals. This change does
not claim native indexed keyset SQL, constant-cost counts or measured Cosmos RU savings; deployed
measurements should guide that next optimization ([query backend](comment-query.md)).


The label filter also runs before page selection, using the current effective label catalog. Removed
catalog IDs match no threads even if historical assignments remain. Label changes reset cursor and
selection scope, and the routing projection retains label IDs without loading message bodies.
