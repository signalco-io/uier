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
  `ready` links still open on that status. Each status shows its `StateDot` in its colour ([status colours](comments-inbox.md)):
  Done's tab, the three statuses in the menu, and the Active tab while it names one; Active and All have none. The menu button is a plain button inside the toggle group: Tab reaches it,
  the arrow keys move between the tabs only. Each filter in effect shows under the bar with its own clear button ("Clear filter: Unread",
  "Clear author filter: ..."). The count line under them (`TriageSelection`) has the count with the unread
  count, Mark all as read and Select; Select shown results and the bulk actions are in the selection bar that
  floats over the end of the comments once something is selected ([App triage](triage.md#selection)).
  `LocationFilter`: environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts`. Choosing an environment
  keeps the panel open and reloads its pages.
