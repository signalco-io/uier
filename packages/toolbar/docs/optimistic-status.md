# Optimistic status changes

`useComments` applies pending resolve/reopen changes to every cached page/site list, including
poll responses, and restores the previous status on failure. Pending changes carry the reviewer
revision; an old response must never repopulate a cache cleared by sign-out or lost access. Only
remove the pending entry owned by the settling mutation. Create/reply drafts retain their existing
immediate rendering, stable submission identity and failure recovery. The delayed-response browser
checks live in `apps/web/e2e/app-performance.spec.ts`.
