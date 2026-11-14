# Feedback export

The public and review `comments/:id/context` routes and the app `copyIssueAction` read fresh
authorized feedback. `src/lib/review/feedbackContext.ts` is the common project service;
`src/lib/comments/feedbackContext.ts` projects filtered DTOs into the shared
`@uier/toolbar/feedback-context` model. Keep public/guest browser restrictions, deleted evidence
redaction, canonical page state and protected screenshot references intact. The complete packet
contract is in [docs/feedback-context.md](../../../docs/feedback-context.md); future MCP/tracker
work should reuse it. Coverage lives in `e2e/feedback-context{,.api}.spec.ts`.
The formatter renders inline values (including titles and names) as literal code spans, suppressing
tracker autolinks/mentions without changing the structured context. Only approved explicit links
remain clickable.
Reply images are projected as protected `discussion[].screenshot` references only after checking
their saved image documents. Each reply's Markdown includes its image link; deleted replies and
missing images omit it. Member, guest review and public exports use their existing image routes.
A comment's drawing ([canvas mode](../../../packages/toolbar/docs/canvas-mode.md)) is projected from the
filtered DTO (`feedbackDrawing`) only when the feedback itself is available; deleted evidence drops it with the
anchor details.
Exports of uier's own feedback include `identity.projectId` (`uier00000001` or `uier00000002`), derived from the resolved
partition even for legacy records. Isolated local host partitions have no project id. Never infer
the owning project from the reviewed page path: `/app/projects/<id>` feedback belongs to uier.
