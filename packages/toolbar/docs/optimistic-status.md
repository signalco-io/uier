# Optimistic status changes

`useComments` applies pending status changes (Done and Reopen through `resolve`, Open and In progress
through `progress`; `pendingStatuses`) to every cached page/site list, including
poll responses, and restores the previous status on failure. Pending changes carry the reviewer
revision; an old response must never repopulate a cache cleared by sign-out or lost access. Only
remove the pending entry owned by the settling mutation. Create/reply drafts retain their existing
immediate rendering, stable submission identity and failure recovery. The delayed-response browser
checks live in `apps/web/e2e/app-performance.spec.ts`.

The thread header's status is a menu like the app's `StateMenu` (Open, In progress, Ready to verify,
Done), with no separate Mark as done button: the same `allowed` rules as the app's `allowedStatuses`
(resolve permission; from Ready to verify, Open and In progress need the cancel permission and send the
verification cancel with that `status`; Ready to verify needs the request permission and opens the
request form). People who may change nothing see the badge. Done keeps In progress cleared, Reopen
leaves it. S focuses the menu's badge (`data-uier-status`). The delayed Done and In progress checks are
in `app-performance.spec.ts`; the menu in `toolbar-thread.spec.ts`, `verification.spec.ts` and
`shortcuts.spec.ts`.


Archive/restore uses the same reviewer-scoped pending machinery (`archive`, `archivedAt`) and cache
invalidation. Toolbar page and site lists fetch `archive=exclude` and `archive=only` separately, each
with its own server limit; pins, highlights, inline slots and ordinary inbox status filters exclude archived threads. Archive, chosen from the menu beside the Done tab, lists them with
Restore comment in Thread options, using resolve authority; its preview has no Show on page action.
Workflow status stays separate and unchanged. A failed archive rolls back every cached list and shows
an error toast even when its optimistic removal unmounted the pin. All six catalogs include the archive
labels and announcements. Activity summaries keep archived separate from ordinary totals and unread
badges. Site-wide totals remain authoritative; page/search lists keep their existing bounded windows.


Custom status menus load `/api/review/<project>/statuses` through a shared query and send `PATCH { statusId }`. This isolated menu mutation leaves inbox paging and legacy optimistic status mutations unchanged; it disables the menu while saving, updates cached comments only for the same reviewer revision, and invalidates comments/activity on settlement. Ready requests carry the selected ID to the reviewer form; canceling to a custom Open/In progress status carries its ID too. Archive entries select the exact archive status. Descriptions appear under their labels.
