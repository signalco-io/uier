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
| `title` | Concise derived summary, at most 100 saved-text characters plus a rewrite label. It does not replace the exact message. |
| `kind`, `status` | Saved feedback type and current open/done status. |
| `assignee` | Optional display name from the current project-member list, only for member exports. Unavailable assignees use "Former member"; no account id or email is added. |
| `feedback` | First message or `null`: id, deletion state, exact current saved text, quoted text, display author and saved creation/edit times. Deleted placeholders omit text, quote and author. |
| `anchor` | Whole page, saved element selector or selected text, selectors and offsets. This describes saved evidence, not a claim that the element still exists. Deleted/missing first items retain only anchor type. |
| `source` | Canonical stored `path`, permitted original `origin` when available. Optional `environment` is the current configured label or historical-source fallback. It follows the same member/current-origin permission rules as the source context; labels do not retarget links. |
| `links` | Optional approved page URL and token-free comment review entry. Removed/unavailable origins do not fall back to a different address. |
| `reproduction` | Original coarse device/viewport; original browser, OS, pixel ratio and capture time only for members who can already view those fields. Never measurements from the exporting browser. |
| `screenshot` | `{ state: 'unavailable' }`, or `protected` with an existing access-checked URL, dimensions and optional evidence revision. No image bytes, credentials or signed public bypass. |
| `discussion` | All saved replies in their saved order with the same message projection. |
| `notes` | Limits: edits are current saved versions, prior versions are not retained; deleted evidence is omitted. |

Project-backed packets always include the owning `identity.projectId` and a **Project** line in
Markdown. Public uier feedback uses `uier00000001`, including feedback on `/app/projects/<id>`:
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
