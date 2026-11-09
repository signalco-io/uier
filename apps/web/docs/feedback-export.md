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
Public-project exports include `identity.projectId: uier00000001`, derived from the resolved
partition even for legacy records. Isolated local host partitions have no project id. Never infer
the owning project from the reviewed page path: `/app/projects/<id>` feedback belongs to uier.
