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

A `change` reason wins over other reasons in the same notification window. Existing toolbar
callbacks ignore the reason and keep their own foreground/HTTP scheduler. The app refreshes true
changes immediately and compares its authorized server revision for other signals, so an unchanged
idle view need not rerender the entire shell. Its current-page authorization and comment checks
remain live; [app shell](../../../apps/web/docs/app-shell.md#idle-comments-refreshes) describes the
five-minute shell safety refresh and preservation of drafts, focus, selected thread and optimistic
state. The callback reason is local browser metadata, never a new WebSocket payload or identity.
