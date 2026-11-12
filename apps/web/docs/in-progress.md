# In progress

A thread's stage is `feedbackStage` (`@uier/toolbar/verification`, pure, shared by app, toolbar and
server): Done, Ready to verify (pending check), In progress (`DbComment.inProgress`), else Open. A
missing flag means not in progress; never migrate. `resolved` keeps its meaning for every client:
`ordinaryVerificationStatus` clears the flag on Done and leaves it on a same-status or `false` write,
so old clients, bulk Reopen and provider polls never drop it. `setProjectCommentStatus` (`open`,
`in-progress`, `done`; `canResolveComment`, one `withOrdinaryStage` write) is the only way to set or
clear it directly; it emits `progress-started` / `progress-stopped` (digest lines, MCP
`progress_started` / `progress_stopped`) or the usual `resolved` / `reopened`. The flag stays while a
check is pending. App writes go through `setCommentStatusAction`; the review and same-origin PATCH
routes take `{ status }` or `{ resolved }`, never both. Lists, counts, tabs and the board read the
stage, never the raw flag; the app's Active tab and MCP `status: "open"` mean not done, the app's Open tab means Open only. Focused coverage is
`in-progress.api.spec.ts`, the MCP spec, `comment-board.spec.ts`, `verification.spec.ts` and
`toolbar-app-parity.spec.ts`. See [review workflow](../../../docs/review-workflow.md#in-progress).

Custom statuses refine these categories through `workflowStatusId`; they never replace the
`inProgress`/`resolved`/verification stage. App ID writes use `setProjectCommentWorkflowStatus`
with fresh project/settings validation. Ordinary category transitions clear obsolete refinements
and choose the target category's default. Same-category moves retain the stage and completion
clock. Archive has its own `archiveStatusId`, preserving the ordinary ID for restore.


Toolbar status menus offer the effective custom statuses grouped by category, with descriptions. Same-category moves record status activity; Ready-to-verify moves preserve the current check. The write path reuses the project authorized for each conditional-write attempt when loading workflow defaults.
