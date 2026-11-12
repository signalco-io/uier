# Comment filters and priority

- Priority shows as `PriorityFlag` (`comments/PriorityFlag.tsx`), Lucide's `Flag` in the priority's colour (Low
  `--muted-foreground`, Normal `--foreground`, High `--brand-warning`, Urgent `--destructive`; BRAND.md, "Colour"),
  beside the name in the thread, the Priority filter and Set priority; on rows and cards the flag stands alone
  (`PriorityLabel`, `role="img"` named "High priority", no tooltip, like the row's Private lock). It is coloured
  through `stroke`, because highlighted menu and select items set the text colour of everything in them.
  `e2e/priority-flag.spec.ts` covers it.
- The comments' filter bar (`CommentFilters.tsx`): search on the left, then at the right end of that row the filters in
  effect, one Filter button (a popover with Status on the board only (below), Priority, Environment
  and page, People (Everyone, Assigned to me, Unassigned, Opened by me) and Only unread (plus the open thread); its badge counts the
  filters in effect) and List/Board (on a touch screen the search, Filter and the List/Board group are one height, 44 px:
  the group's 3 px padding around 38 px tabs; uier #277), then the status tabs
  (list only, `StatusTabs`: Active, Done and All, with counts; on a phone, below `sm`, the group fills the width and
  the tabs share the room, uier #278. Active, the default with no `?status=`, is every status
  but Done; `statusMatches` in `commentLabels.ts`). Open, In progress and Ready to verify fold under Active
  (`activeStatusFilters`) to keep the tabs narrow: the "Active statuses" button beside the Active tab (24px wide, the WCAG 2.5.8 minimum; wider on touch) opens a menu of
  Active and the three, each with its count, and a choice closes it. The Active tab then names the choice ("Active: In
  progress 4") and stays pressed; pressing it again goes back to every active status. `?status=open`, `in-progress` and
  `ready` links still open on that status. Archive folds under Done the same way (uier #302, `doneStatusFilters`): the
  "Done and archive" button beside the Done tab opens a menu of Done and Archive with their counts; with Archive chosen the
  tab reads "Archive 2" and stays pressed, and pressing it again goes back to Done. `?status=archived` still opens Archive. The tabs have no `StateDot`, so Done never reads as a
  notification; the three statuses in the menu show theirs in its colour ([status colours](comments-inbox.md)). The menu button is a plain button inside the toggle group: Tab reaches it,
  the arrow keys move between the tabs only. Each filter in effect shows in the search row, left of the Filter button (uier #209; in the list and the board,
  wrapping only when there is no room; on a phone they go to their own line under the row), named by its filter in muted text ("Priority: Urgent",
  "Environment: Production", "Page: /app/…", "People: Unassigned", "Author: Ana", and "Only unread"), with its own
  clear button, named by its visible text first so the name contains the label (WCAG 2.5.3): "Page: /app/…, clear filter",
  "Author: Ana, clear filter", "Only unread, clear filter". The count line under them (`TriageSelection`) has the unread
  count, a toggle for Only unread (uier #193, like the toolbar's Unread toggle: the kit's `Toggle`, named "7 unread, show
  only unread", pressed while the filter is on, the count still in the unread accent; while the filter is on it stays, at "0 unread"
  in muted text too, so it can be turned off where it was turned on), then Mark all as read right beside it (a small filled `secondary` button whose icon takes the unread
  accent, so it reads as that count's action). There is no Select (uier #179): selecting starts from a row's box, x, or a long press on a
  touch screen ([App triage](triage.md#selection)). The toolbar's inbox has the same count line under its
  filters (`packages/toolbar/src/components/sidebar/MarkAllRead.tsx`: "7 unread", then Mark all as read with its icon), and its
  Unread toggle ("Unread 7") is a filter like Only unread here: no dot, the count in the unread accent. Its status tabs are these
  (uier #216, `CommentsStatusTabs` in `sidebar/CommentsSidebarHeader.tsx`): Active (`unresolved`, the default), Done and All, with the
  same Active statuses menu (a toolbar `Popper`, the `uier-status-filter-menu` part: Active, then Open, In progress and Ready to verify
  with their status dots and counts) and the same "Active: In progress 4" tab, and the same Done tab with Archive in its "Done and archive" menu (`doneStatusFilters`
  in `CommentsFilter.tsx`); underlined like the toolbar's other tabs. Site-wide
  counts come from the activity summary, Open as its not-done count less In progress and Ready to verify. Neither view has "15 of 93 comments": the
  list's status tabs and the board's columns already count what is shown. Where the comments are at least 42rem wide
  (`@2xl/comments`, `countLineInHeader` in `CommentFilters.tsx`; uier #300) the count line is in the search row instead, right-aligned
  just left of the filters in effect and Filter (`CommentFilters`' `countLine`), and `TriageSelection`'s own line is hidden there: an
  unread count appearing or going to zero changes only that spot (the filters in effect are right-aligned against Filter, so they
  stay too), and with no unread count it is `sr-only`. That width fits the search's minimum, the count, Filter and List/Board on
  one line. Narrower (a phone), the count line keeps its own row under the status tabs. There a populated project inbox keeps the count line's
  32 px height (44 px on touch) when it has no unread count, so automatic reads and incoming unread feedback do not move the list or board.
  Empty projects hide it; callers without `reserveLine` retain the collapsed `sr-only` line. Its status stays mounted
  for announcements. The count line has no side padding of its own and takes the filters header's width, so its
  edges line up with the search and Filter row (and the view toggle) in the list and the board, the board's wide layout too; Select shown results and the bulk actions are in the selection bar that
  floats over the end of the comments once something is selected ([App triage](triage.md#selection)).
  `LocationFilter`: its trigger is named by what it shows, then "environment and page" ("Production · /pricing, environment and page").
  Environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts` (the sections and their matching come from
  `@uier/toolbar/page-sections`, which the toolbar inbox's `LocationPicker` uses for the same split: environments, this page, all pages and the sections
  on its left, the other pages with their search on its right). Choosing an environment
  keeps the panel open and reloads its pages. "Removed addresses" and
  "Source not recorded" show only when comments have that source (`historySources`, worked out in `ProjectComments`
  from the loaded comments when every environment is loaded and the search window is not capped); when that is not
  known they show, and a chosen one always shows. The pages column has no environment label of its own: the
  environment column beside it shows the choice. The chosen environment and page have the `accent` background
  as well as the check mark. Each option has a `title` with its full label, since long paths are
  truncated.


The board has no status tabs: its Filter popover starts with Status (uier #335, `boardStatusFilters` and `boardStatusFilter` in
`commentLabels.ts`): All statuses, then Open, In progress, Ready to verify and Done, each with its status dot and count. It
is the list's `?status=`, so a status chosen in one view stays in the other; Active and All show every column on the board.
A status narrows the board to that column: the other columns stay, empty, as drop targets, Archive's cards hide, and
Select shown results takes only what is shown. It shows in effect as "Status: Done", counts in Filter's badge, and Clear
filters (or its chip) goes back to every column. `comment-board.spec.ts` covers it.

Archive (`status=archived`) is a separate list scope, chosen from the menu beside the Done tab. All includes ordinary
workflow statuses, without archived threads. Archive uses the same search, people, page, priority,
unread, author and environment filters. The board excludes archived cards and offers Archive as a
separate list. The toolbar's `archived` scope follows the same rule; its `all` filter excludes archive.
