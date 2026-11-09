# App triage

`@uier/toolbar/triage` owns the pure priority vocabulary/default and deterministic literal word matcher.
`ProjectComments` searches only the server-authorized snapshot (200-character `q`, debounced
replaceState), alongside local filters. Environment/author still navigate. `loadProjectComments`'s
window callback discloses the 1,000-thread storage cap even if hidden rows shrink the client snapshot.
Never send deleted or ineligible text to client search.

`review/comments.ts` owns priority, assignment and status writes. `bulkTriageSchema.ts` validates one
operation and 1–50 distinct ids/keys; `bulkTriage.ts` runs at most four shared mutations concurrently.
Affected-value guards execute inside every CAS attempt. Status also checks `commentRevision`, a
stable opaque hash covering content and future workflow metadata; only delivery metadata is excluded.
Add verification behavior to the shared status service, preserving this guard and never creating
reviewer confirmation from bulk Done. Receipts retain changed/no-op outcomes; replay reauthorizes
without applying the old desired state. The optional store argument supports isolated failure/race
coverage without replacing process-global stores.

`TriageSelection` snapshots exact visible ids, operation, expected values and keys, clears selection
on scope/view changes, rolls back failures through `CommentUpdates`, retains visible failures and
retries uncertain requests with the same keys. Revalidate once per batch, without router.refresh.
Ordinary public-project enrollment grants no priority or bulk powers; `canTriageProject` is enforced
in services and DTOs. Priority adds activity/integration intent only, with no email event. Read it via
`commentPriority` everywhere. Tests: `triage{,.api}.spec.ts`, MCP, feedback-context and integration
suites. See [review workflow](../../../docs/review-workflow.md#search-priority-and-bulk-triage).

## Selection

Selecting stays out of sight until it is used, like Linear's and Gmail's lists. A row's (or card's) box starts
the meta line under the author's avatar, so the page path lines up with "#12 …" (a card's bottom left), and shows only
while the row is hovered or has keyboard focus (`SelectComment`: `opacity-0` until then, still focusable and named). Unchecked, its edge is
`border-muted-foreground`, not the input border, which fades into the hovered row's muted surface (uier #178).
It keeps its room at rest, so the path does not move when it appears; the title line never gives it room. A mouse
hovers the row before it reaches the box (`selectThread` in `e2e/support/app.ts` does too). Tab reaches it after
the row's link (and a card's Move), before the assignees. A touch screen has no hover: there the box at rest takes no
taps (`pointer-coarse:pointer-events-none`, so a tap where it is opens the row), but stays in the accessibility tree
and the Tab order, which is how screen reader users on a touch screen start selecting (they reach "Select comment #12"
and double-tap it). Everyone else on a touch screen starts with a long press on a row or card (uier #179): held still
for 600 ms (`longPressDelay`, within 10 px, `pressTolerance`) it selects the row while the finger is down. The press
then opens nothing, drags nothing and shows no link menu (`contextmenu`, `dragstart` and `selectstart` are prevented while a
press may become long, and the click after it is dropped); rows with a box are `select-none` and have no touch callout on
a touch screen. On the board a card held 250 ms is armed (`data-hold`, a slight scale) and lifts only when the finger then
moves (`HoldTouchSensor`); held still to the long press, the sensor lets go and the card is selected. The comments page
has no Select button: the count line holds only the unread count and Mark all as read. Selecting is on while
anything is selected, or after a batch or Select shown results (`explicit`), and then every row shows its box and a
checked row is tinted. The selection bar (`role="group"`, "Selected feedback actions") floats instead of
pushing a row into the layout: `sticky` at the bottom of the scrolling panel, after the comments on screen
(`order-last`) but before them in the focus order. It has Clear selection, Select shown results (or
Select first 50 shown) with the count, then Assign, Priority, Done and Reopen, whose accessible names stay
"Assign selected", "Prioritize selected", "Mark selected as done" and "Reopen selected"; under `@xl/comments`
the actions take a line of their own without their icons. The outcome, the threads needing attention and
Retry failed threads show above the actions, so they never move. The thread beside the list keeps clear of
the bar through `--selection-bar`.

Keys act from a row, a card or the bar, never while typing or in a menu or dialog: x selects the focused row,
Ctrl or ⌘ + A the shown results, Escape ends selecting (also from the page). Shift-click on a box selects the
range from the last box clicked. While selecting, a touch tap (or another long press) on a row toggles it instead of
opening it; the mouse and Enter still open it. Clear selection or Escape end selecting: nothing selected, no
outcome, every row back at rest. When the bar had the focus it goes to the link of the row last selected (the first
shown row without one); a focused box keeps it and stays shown, since the key press makes it `:focus-visible`.
`triage.spec.ts` covers rest, pointer, Shift-click, keyboard, the long press (no menu, no text selection, no
opened thread), touch taps, the bar on a phone, focus and axe in both themes; `comment-board.spec.ts` a long press on a
card that neither lifts nor opens it. `longPress` in `e2e/support/app.ts` holds a finger with CDP touch events until a
condition holds; `heldForDrag` waits for a held card's `data-hold` before moving it.

Bulk assignment retains the single-target replacement action: it replaces every assignee with the
selected person (Unassigned clears all). The app sends the content revision with the assignment
snapshot, so a change to any co-assignee/agent conflicts rather than silently removing newer work.
Results return all current assignees and their agent views so status/priority batches preserve them.
