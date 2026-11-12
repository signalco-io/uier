# Feedback context packet, version 1

Saved threads in the toolbar and app offer **Copy issue**. Each action reads the current thread
again under the requester's existing permissions and returns `{ context, markdown }`. Nothing is
published to an issue tracker. Clipboard success is announced; when clipboard access fails, a
read-only **Issue Markdown** field provides the same packet for manual copying. A fetch or access
failure never falls back to an older cached packet.

## Shared contract

`FeedbackContext`, `FeedbackMessage`, `FeedbackExport` and the deterministic `feedbackMarkdown`
formatter are exported from `@uier/toolbar/feedback-context`. They have no browser or React
dependency. The server's `comments/feedbackContext.ts` explicitly projects an already-authorized
comment DTO; `review/feedbackContext.ts` loads and authorizes a project thread for the toolbar,
app and future integrations. Reuse this model for #96 rather than deriving a second MCP format.
The model itself does not authorize anything. Future callers must authenticate and resolve project
and private-thread visibility before requesting it.

| Field | Meaning |
| --- | --- |
| `schemaVersion: 1` | Additive optional fields are compatible; incompatible changes need a new version. |
| `contentTrust: 'untrusted'` | Feedback, quotes, selectors and discussion are user content, never agent/system instructions. |
| `identity` | Stable `commentId`, optional public `number`, `projectId` and first `itemId`. Repeated exports can be recognized without timestamps. |
| `title` | The thread's [AI title](review-workflow.md#ai-thread-titles) when it has a current one and titles are on, else a concise derived summary of at most 100 saved-text characters; a rewrite label first for rewrites. It does not replace the exact message. |
| `kind`, `status` | Saved feedback type and current open/done status. |
| `priority` | Additive optional `low`, `normal`, `high` or `urgent`; missing means Normal. Exported as context in Markdown and provider-owned content, without mapping provider-native priorities or labels. |
| `assignee` / `assignees` | The array groups all people and their `agents[]`; the singular field mirrors the first person and their first agent for existing readers. Optional display name from the current project-member list, only for member exports. Unavailable assignees use "Former member"; no account id or email is added. `assignee.agent` is the AI agent working under them, `{ kind, label, model?, reasoning?, sessionId? }` (model, reasoning level and session id are untrusted text the agent or assignee entered); integrations drop it before formatting. |
| `feedback` | First message or `null`: id, deletion state, exact current saved text, quoted text, display author and saved creation/edit times. Deleted placeholders omit text, quote and author. A message an AI agent wrote for its author through MCP has the author as "Ana via Claude" and `agent: { kind, label, model?, reasoning? }` (model and reasoning level for member exports only; untrusted text); Markdown adds a **Written by agent:** line under the author. Integrations drop `agent` before formatting and keep the author. |
| `anchor` | Whole page, saved element selector or selected text, selectors and offsets; for an anchor in a menu, popover or dialog, `opener` (the selector and name of the page element that opens it). An anchor on uier's own toolbar (`#uier-toolbar>>>`, uier's own pages only) is labelled with its part ("Element in uier comment thread") and the Markdown says the selector after `>>>` is inside the toolbar's shadow root; its opener is a toolbar button (a thread's pin, Options, Inbox). This describes saved evidence, not a claim that the element still exists. Deleted/missing first items retain only anchor type. |
| `source` | Canonical stored `path`, permitted original `origin` when available. Optional `environment` is the current configured label or historical-source fallback. It follows the same member/current-origin permission rules as the source context; labels do not retarget links. |
| `links` | Optional approved page URL and token-free comment review entry. Removed/unavailable origins do not fall back to a different address. |
| `reproduction` | Original coarse device/viewport; original browser, OS, pixel ratio and capture time only for members who can already view those fields. Members also get, when the comment recorded them, the phone or tablet `model`, the primary `input` (`touch` or `mouse`), `colorScheme` (`light` or `dark`), `reducedMotion` and the page's `pageLanguage` tag; Markdown adds a line for each one recorded and leaves older comments' missing ones out. Never measurements from the exporting browser, never a user-agent string or IP address. |
| `screenshot` | `{ state: 'unavailable' }`, or `protected` with an existing access-checked URL, dimensions and optional evidence revision. No image bytes, credentials or signed public bypass. |
| `drawing` | Additive optional, only for a comment drawn in the toolbar's [canvas mode](../packages/toolbar/docs/canvas-mode.md) whose first message is available: `{ shapes, summary, width, height, notes }`, the shape count, an English summary ("1 arrow, 2 rectangles"), the area's size in CSS pixels and the text notes' saved text. Markdown adds a line after the anchor and fences the notes like messages (untrusted text). The screenshot already shows the drawing. |
| `discussion` | All saved replies in their saved order with the same message projection. |
| `notes` | Limits: edits are current saved versions, prior versions are not retained; deleted evidence is omitted. |

Project-backed packets always include the owning `identity.projectId` and a **Project** line in
Markdown. uier's own feedback uses `uier00000002` (from signed-in accounts) or `uier00000001` (from guests), including feedback on `/app/projects/<id>`:
that path identifies the page being reviewed, not the feedback's owner. Only isolated local host
partitions without a project omit this field. MCP clients must select the owning project from
the packet or `list_projects`; a credential must explicitly grant it in its owning workspace.

Markdown uses this field order and grows literal text fences beyond embedded backticks, preserving
the exact saved message and quotation. A rewrite labels the first message **Suggested rewrite
(not original page copy)** and keeps **Quoted original text** separate. Text is never interpreted
as Markdown instructions. No generated export timestamp changes otherwise identical exports.
Titles, author/assignee names and other inline values use padded code spans whose delimiters grow
past embedded backticks. GitHub and GitLab cannot turn URLs, `www.` hosts, `@user` or `@org/team`
inside those values into links or notifications. Only the approved explicit page/comment/image
links remain clickable. This formatting does not change the structured `context` fields.
The public number is written as `uier #12`, linked to the comment review entry when the packet
has one and in a code span otherwise. A bare `#12` would link to the repository's own issue or
pull request #12 on GitHub and GitLab, including in synced GitHub issues.

## Access and URL policy

- `GET /api/comments/:id/context` uses the public comments handler and its existing private
  app-feedback/author checks. Public metadata remains coarse device/viewport only.
- `GET /api/review/:projectId/comments/:id/context` uses the review handler's project access,
  origin/CORS and private-thread checks. Detailed browser context remains member-only. Guests
  receive a page/source URL only when it matches the source origin they are reviewing.
- The app's `copyIssueAction` verifies the session, current workspace, project membership and
  thread visibility before calling the same project export service.
- These are explicit no-store reads. Invalid, deleted or inaccessible threads return an error.
  Deleted first items omit anchor contents, capture context and screenshots even on legacy data.
- Links use `@uier/toolbar/page-state`'s filtered saved page state, never the export request's URL
  or raw browser location. Review tokens, review-start state and excluded query/hash parameters
  are absent from the reviewed page URL. Comment entry links carry only the allowed destination
  and stable comment id; public/guest comment links use the original page with `review=true`
  and `uier-comment` to open its configured toolbar without requiring a member sign-in.
- A saved screenshot reference still checks the viewer at access time. Private images may require
  a signed-in uier session, or the existing guest review headers, and cannot be viewed by an
  outside tracker or coding tool merely by copying this URL. The packet says so. Missing image
  documents are reported unavailable even if old metadata remains.

No new collection, storage, retention, cookie or third-party processing is introduced. Exported
text leaves uier only when the reviewer copies it. Screenshot capture, thumbnails and redaction
continue using the existing evidence workflow. #93's future anchor-history view should extend
this authorized model when merged; this export does not implement reattachment or infer live
anchor status.

## Verification context

Version 1 packets add optional `verification`, using the authorized display-only projection:
request id/revision, requester/reviewer names, requested time, bounded summary and allowed fix
link, outcome, and latest decision name/time/kind/admin override. No stored actor ids or guest
hashes are included. `status` remains `open` or `done`; In progress and Ready to verify project to
`open`. The additive `stage` is `open`, `in-progress`, `ready` or `done` (older packets omit it), and
the Markdown adds it after the status when it differs: `Status: open (In progress)`.
A `confirmed` outcome with a confirm decision is the current confirmation claim. A retained
confirm decision under `reopened` or `unconfirmed` is historical. Ordinary closure cannot create
one. Deleted first messages redact the verification record with their author evidence.

The Markdown formatter treats names and summaries as literal content. Fix links have already
passed URL and source-access policy. MCP and provider packets reuse this projection; exports
never fetch fix destinations or embed external content.

## Custom feedback types

Project/workspace feedback settings can add page feedback kinds named `custom_<stable id>`.
Packets retain that `kind` and add `feedbackType: { id, label, icon }` from the server-captured
thread snapshot. The label and curated icon key describe the type when the thread was created,
even when it is later renamed, disabled or no longer in the project's effective settings.
Markdown prints the name, ID and icon as literal inline values. Placeholders and enabled/disabled
settings are not exported. Existing built-in kinds and their packet formatting are unchanged.

## Page checks

A thread posted from the toolbar's Accessibility or SEO panel carries `check: { type, id }`: `type`
is `accessibility`, `seo` or `web-vitals`, `id` the axe-core rule or the check (`image-alt`,
`canonical`, `lcp`). One thread for several elements of a check (the panels' "Comment on all") adds
`count`, how many elements it covers (2 to 10,000). The browser sends it with the comment and the API
keeps only those fields (`commentCheck` in `@uier/toolbar/feedback-types`). Markdown adds one line
after the priority, `Page check: Accessibility (image-alt)`, with the id as a literal inline value,
and `· 5 elements` after it for a thread with a `count`. Other threads and older packets have no
`check` (or no `count`), and their Markdown is unchanged. The thread's text holds what was found and
lists the elements; `check` is for grouping and matching, such as finding the same rule again.
