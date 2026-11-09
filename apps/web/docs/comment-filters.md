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
  (list only: Active, the default with no `?status=`, is every status but Done; then Open, In progress, Ready to
  verify, Done and All, each one status except All; `statusMatches` in `commentLabels.ts`). Each filter in effect shows under the bar with its own clear button ("Clear filter: Unread",
  "Clear author filter: ..."). The list header (`TriageSelection`) has Select shown results, the count with
  the unread count, and Mark all as read; the bulk actions appear only once something is selected.
  `LocationFilter`: environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts`. Choosing an environment
  keeps the panel open and reloads its pages.
