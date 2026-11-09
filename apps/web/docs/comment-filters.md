# Comment filters and priority

- Priority shows as `PriorityFlag` (`comments/PriorityFlag.tsx`), Lucide's `Flag` in the priority's colour (Low
  `--muted-foreground`, Normal `--foreground`, High `--brand-warning`, Urgent `--destructive`; BRAND.md, "Colour"),
  beside the name in the thread, the Priority filter and Set priority; on rows and cards the flag stands alone
  (`PriorityLabel`, `role="img"` named "High priority", no tooltip, like the row's Private lock). It is coloured
  through `stroke`, because highlighted menu and select items set the text colour of everything in them.
  `e2e/priority-flag.spec.ts` covers it.
- The comments' filter bar (`CommentFilters.tsx`): search, one Filter button (a popover with Priority, Environment
  and page, People (Everyone, Assigned to me, Unassigned, Opened by me) and Only unread (plus the open thread); its badge counts the
  filters in effect) and List/Board, then the status tabs
  (list only, `StatusTabs`: Active, Done and All, with counts. Active, the default with no `?status=`, is every status
  but Done; `statusMatches` in `commentLabels.ts`). Open, In progress and Ready to verify fold under Active
  (`activeStatusFilters`) to keep the tabs narrow: the "Active statuses" button beside the Active tab opens a menu of
  Active and the three, each with its count, and a choice closes it. The Active tab then names the choice ("Active: In
  progress 4") and stays pressed; pressing it again goes back to every active status. `?status=open`, `in-progress` and
  `ready` links still open on that status. The tabs have no `StateDot`, so Done never reads as a
  notification; the three statuses in the menu show theirs in its colour ([status colours](comments-inbox.md)). The menu button is a plain button inside the toggle group: Tab reaches it,
  the arrow keys move between the tabs only. Each filter in effect shows on the status tabs' line (wrapping under them only when there is no
  room; on the board, which has no tabs, on its own line), named by its filter in muted text ("Priority: Urgent",
  "Environment: Production", "Page: /app/…", "People: Unassigned", "Author: Ana", and "Only unread"), with its own
  clear button ("Clear page filter: /app/…", "Clear author filter: Ana", "Clear filter: Only unread"). The count line under them (`TriageSelection`) has the unread
  count, then Mark all as read right beside it (a small filled `secondary` button whose icon takes the unread
  accent, so it reads as that count's action), and Select at the end. Neither view has "15 of 93 comments": the
  list's status tabs and the board's columns already count what is shown. With a mouse Select is `sr-only` until something is selected (or it has keyboard focus),
  since hovering a row's box starts selecting; a touch screen always shows it. When it shows nothing (no unread count and, with a mouse, nothing selected) the
  count line is `sr-only` too: it takes no room and no gap in the column, and shows again while Select has the keyboard focus. The count line has no side padding of its own, so its
  edges line up with the search and Filter row in the list and the board; Select shown results and the bulk actions are in the selection bar that
  floats over the end of the comments once something is selected ([App triage](triage.md#selection)).
  `LocationFilter`: environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts`. Choosing an environment
  keeps the panel open and reloads its pages. "Removed addresses" and
  "Source not recorded" show only when comments have that source (`historySources`, worked out in `ProjectComments`
  from the loaded comments when every environment is loaded and the search window is not capped); when that is not
  known they show, and a chosen one always shows. The pages column has no environment label of its own: the
  environment column beside it shows the choice. The chosen environment and page have the `accent` background
  as well as the check mark. Each option has a `title` with its full label, since long paths are
  truncated.
