# Feedback export

`ExternalFeedbackLink` is a browser-safe provider/url type exported alongside the feedback
contract. Its values are projected separately on the server for current project members; never
put another destination's links into an outbound feedback packet or infer provider access from a
URL. Source synchronization versions, pending flags, deletion markers and credentials stay server-only.

`components/CopyIssue.tsx` reloads `/comments/:id/context` on each copy and provides a manual
Markdown fallback. Success appears beside the copy icon for two seconds without changing the
thread layout; the shared announcer reports it to screen readers. Errors and manual copy text
stay available until the reviewer retries or closes the text. `@uier/toolbar/feedback-context` is
the pure versioned model and deterministic formatter for toolbar/app and future integrations.
Titles, names and inline values use variable-length padded code spans to suppress GitHub/GitLab
autolinks and mentions; messages/quotes remain fenced and the structured context stays unchanged.
Authorization and private-field projection
belong on the server; never format a raw document or browser location for export. See
[the shared contract](../../../docs/feedback-context.md).

Replies may include a protected `screenshot` reference. The formatter places a **Reply image** link
and dimensions under its message; deleted messages omit it. The server verifies each image exists
and chooses the existing access-checked route for the viewer.

A comment with a drawing ([canvas mode](canvas-mode.md)) adds `drawing` (shape count, an English summary,
the area's size and the text notes) to the packet; the Markdown describes it after the area and fences the
notes' text like messages. The screenshot reference is unchanged: the drawing is already painted into it.

Custom page feedback retains its stable `kind: custom_<id>` and optional server-captured
`feedbackType: { id, label, icon }` in the version 1 packet. The display snapshot is independent of
current workspace/project settings, and includes neither the placeholder nor the enabled state.
Markdown prints its literal name, stable ID and curated icon key. Built-in kinds and their existing
Markdown stay unchanged. The same snapshot passes through toolbar/app DTOs, MCP list/single/batch
reads and MCP event payloads; it never comes from client-submitted display metadata.


Member assignment agents can carry a validated `sessionUrl`. The packet formatter prints it as a
literal value; connected-service delivery strips assignment agents before formatting. Guest
projections never include agents. `CommentAssignment` lets a member open Assignee details from the
header avatars when a supported session link exists, with a native `Open in <app>` link beneath its
agent. It rechecks the shared `agentSessionLink` allowlist before rendering; older agents without a
link keep their existing tooltip. See [desktop session links](../../../apps/web/docs/assignee-agents.md#desktop-session-links).
