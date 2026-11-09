# Page and mutation responsiveness

Project comment views mount `RealtimeComments`: native Vercel sockets notify, then refresh the
authorized server snapshot in a transition. `src/lib/realtime` owns origin/viewer-bound tickets,
current authorization and a shared, two-second compact Cosmos metadata source. Never broadcast
comment bodies/ids or bypass private-thread visibility. Keep four-minute connection renewal,
HTTP fallback, draft preservation and the provider boundaries. See [realtime](../../../docs/api.md#realtime-comment-changes)
and `e2e/realtime.api.spec.ts` / `e2e/realtime.spec.ts`. Sockets need Fluid compute, enabled on the
Vercel project by Pulumi (`infra/src/vercel.ts`), not `vercel.json`: prebuilt CI deploys never read it.

Agent working leases (`assigneeAgent.workingUntil`) use the same etag-based realtime refetch as
attachment changes. They do not advance unread activity, content timestamps or edit revisions. The avatar's shared
`useAgentWorking` timer removes the spinner and working label when the lease expires, even without
a socket or successful refresh; renewals replace that deadline and clean up the old timer. No
presence polling is added, and replies/drafts/focus remain in their existing client state.

`projects.ts` and `members.ts` share repeated render reads through React `cache` (metadata,
layouts and pages). `loadWorkspaceAccessForRender` shares the render's team snapshot; mutation
retries must continue to use uncached `loadWorkspaceAccess`. Nothing caches access across requests.
Independent context and comment enrichment reads run together. General settings streams lightweight
usage totals after its authorization check instead of enriching every comment before rendering forms.
Keep authorization/not-found checks outside streaming boundaries so forbidden document requests retain 404.

`ProjectComments` is a client boundary over the server-authorized environment/author snapshot.
Search, status, people, page, unread, list/board filters and the open thread (`?comment=`) are URL
state with no server request: read them with `useUrlSearchParams` and write them with
`setUrlSearchParams` (`src/hooks/use-url-search-params.ts`), not `useSearchParams` and
`history.pushState`. Next.js applies history writes and Back/Forward to `useSearchParams` in a
transition, and React holds that transition while a server action started with `useTransition` is
pending, so UI read from it waits for the write; the hook reads `location.search` and updates during
the click, `popstate` or Next navigation that changes it. Environment and author changes still navigate
through server authorization. Selects that navigate to a server filter (clients, projects, users) show
the choice at once with `useOptimistic` inside the navigation's transition.
The list and every board column show the threads by priority (Urgent to Low), then by number,
highest first: `orderComments` (`commentOrder.ts`, pure, `e2e/comment-order.api.spec.ts`) sorts the
optimistic snapshot once in `ProjectComments`, so filters, columns, drag landing, selection, the
keyboard and realtime changes share it; the server keeps loading newest first for My work.
Whatever changes the shown threads, cards and rows move to their new places (`LayoutMotion`, see
[the inbox and board note](comments-inbox.md#motion)).
`commentsQuery.ts` is the shared pure parser. `CommentUpdates` owns optimistic status, assignment,
follow and read changes for cards, counters and board columns. Failed actions revert through
`useOptimistic`; bulk read keeps rendered cursors and partial-failure retry behavior. Actions already
revalidate and return updated RSC data: do not add a second `router.refresh()` after those writes.
`NavigationPending` gives settings links immediate feedback while their authorized destination loads.
`LinkTabs` puts its spinner last, after any count: at the right end of a section link that fills its
column, in space kept while hidden so nothing moves when it appears. A `line` or `segmented` tab keeps
the same space before its label, so the label sits centred over its underline (or in its pill). A tab
with `query` (the projects list's Active and Done, whose page already holds both lists) changes only
the address, so it has no spinner and keeps no space for one; keep the spinner on tabs that load a page (settings sections,
project tabs, the workspace area).
`e2e/app-performance.spec.ts` blocks filter round trips and holds mutation responses to verify
immediate updates, rollback, persistence and background feedback submission on desktop and mobile,
and that the open thread and the filters follow clicks and Back while a write is held; it also holds a
settings section's page to check where that link's spinner sits, and refuses the projects list's round
trips to check that Active and Done switch at once, with no spinner, through Back, Forward and reload.

Client navigation keeps the embedded toolbar pill mounted; only its page-specific review state
resets. See [client navigation continuity](app-shell.md#client-navigation-continuity) for the
navigation audit, deliberate document boundaries and regression coverage.
