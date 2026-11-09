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
