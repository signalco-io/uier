# Realtime subscription

`src/realtime.ts` is the small shared browser subscription client
(`@uier/toolbar/realtime`). It opens only while the document is visible and online, renews the
short-lived server ticket after reconnects and coalesces HTTP reconciliation signals for 150 ms.
The protocol and server authorization are documented in [the API guide](../../../docs/api.md#realtime-comment-changes).

The `changed` callback receives why reconciliation is needed:

- `ready`: subscribed; read after subscribing to catch edits between the initial snapshot and socket.
- `change`: the server sent `comments.changed`.
- `foreground`: the view became visible/online or received focus.
- `ended`: a previously ready session ended, which can mean revoked access.

A refresh of the inbox's site list reloads as many pages as the reader scrolled to (`useSiteComments`), each after
the oldest comment of the one before, so a comment added meanwhile never repeats or skips a card.

Every write to a thread's document changes its etag, so message reactions arrive like any other change
([reactions](reactions.md)). A `change` reason wins over other reasons in the same notification window. Existing toolbar
callbacks ignore the reason and keep their own foreground/HTTP scheduler. The app refreshes true
changes immediately and compares its authorized server revision for other signals, so an unchanged
idle view need not rerender the entire shell. Its current-page authorization and comment checks
remain live; [app shell](../../../apps/web/docs/app-shell.md#idle-comments-refreshes) describes the
five-minute shell safety refresh and preservation of drafts, focus, selected thread and optimistic
state. The callback reason is local browser metadata, never a new WebSocket payload or identity.

## Refreshes and deployment skew

On `/app/projects/<id>`, `RealtimeComments` calls `router.refresh()` on actual changes, failed revision checks
and the five-minute shell safety refresh. Matching builds merge the RSC snapshot into stable comment keys;
toolbar queries also reconcile in place. Neither scheduler explicitly reloads the document. The toolbar's
React embed leaves its script mounted on client navigation, and the runtime guards duplicate hosts.

The pinned Next.js client (`fetch-server-response`) compares the response's navigation deployment/build id
with the loaded client and returns an MPA navigation on mismatch. A refresh after a new deployment can
therefore become a full page load, including when no navigation was requested by the person typing.
This is a source-confirmed mechanism, not a confirmed trace of feedback #182. Keep this compatibility
recovery and the current authorization checks; drafts must survive it. `app-composer-drafts.spec.ts`
substitutes the RSC response's `x-nextjs-deployment-id` to exercise that real fallback and verifies both
app reply and toolbar feedback drafts. Same-build refresh coverage checks the toolbar textarea remains
connected and only one toolbar host exists. See [composer drafts](composer-popovers.md#drafts-across-reloads)
and [app editors](../../../apps/web/docs/comment-thread.md).
