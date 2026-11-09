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
