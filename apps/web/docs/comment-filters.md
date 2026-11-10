# Comment filters and priority

- Priority shows as `PriorityFlag` (`comments/PriorityFlag.tsx`), Lucide's `Flag` in the priority's colour (Low
  `--muted-foreground`, Normal `--foreground`, High `--brand-warning`, Urgent `--destructive`; BRAND.md, "Colour"),
  beside the name in the thread, the Priority filter and Set priority; on rows and cards the flag stands alone
  (`PriorityLabel`, `role="img"` named "High priority", no tooltip, like the row's Private lock). It is coloured
  through `stroke`, because highlighted menu and select items set the text colour of everything in them.
  `e2e/priority-flag.spec.ts` covers it.
- The comments' filter bar (`CommentFilters.tsx`): search on the left, then at the right end of that row the filters in
  effect, one Filter button (a popover with Priority, Environment
  and page, People (Everyone, Assigned to me, Unassigned, Opened by me) and Only unread (plus the open thread); its badge counts the
  filters in effect) and List/Board, then the status tabs
  (list only, `StatusTabs`: Active, Done and All, with counts. Active, the default with no `?status=`, is every status
  but Done; `statusMatches` in `commentLabels.ts`). Open, In progress and Ready to verify fold under Active
  (`activeStatusFilters`) to keep the tabs narrow: the "Active statuses" button beside the Active tab (24px wide, the WCAG 2.5.8 minimum; wider on touch) opens a menu of
  Active and the three, each with its count, and a choice closes it. The Active tab then names the choice ("Active: In
  progress 4") and stays pressed; pressing it again goes back to every active status. `?status=open`, `in-progress` and
  `ready` links still open on that status. The tabs have no `StateDot`, so Done never reads as a
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
  with their status dots and counts) and the same "Active: In progress 4" tab; underlined like the toolbar's other tabs. Site-wide
  counts come from the activity summary, Open as its not-done count less In progress and Ready to verify. Neither view has "15 of 93 comments": the
  list's status tabs and the board's columns already count what is shown. With no unread count the count line is `sr-only`: it takes no
  room and no gap in the column, and its status stays mounted for announcements. The count line has no side padding of its own and takes the filters header's width, so its
  edges line up with the search and Filter row (and the view toggle) in the list and the board, the board's wide layout too; Select shown results and the bulk actions are in the selection bar that
  floats over the end of the comments once something is selected ([App triage](triage.md#selection)).
  `LocationFilter`: its trigger is named by what it shows, then "environment and page" ("Production · /pricing, environment and page").
  Environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts`. Choosing an environment
  keeps the panel open and reloads its pages. "Removed addresses" and
  "Source not recorded" show only when comments have that source (`historySources`, worked out in `ProjectComments`
  from the loaded comments when every environment is loaded and the search window is not capped); when that is not
  known they show, and a chosen one always shows. The pages column has no environment label of its own: the
  environment column beside it shows the choice. The chosen environment and page have the `accent` background
  as well as the check mark. Each option has a `title` with its full label, since long paths are
  truncated.
