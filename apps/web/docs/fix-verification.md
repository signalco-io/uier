# Fix verification

`review/fixVerification.ts` owns conditional request/confirm/reject/cancel transitions. Reuse
`changeComment` and atomic change receipts; recheck mode, access and reviewer authority on each
attempt. `fixVerificationDto.ts` is pure and must be called only after visibility authorization.
`comments/verificationState.ts` is the pure server ordinary-status projection used by review,
public and provider writes; never infer confirmation from a resolved boolean. New requests and
status transitions rotate the request revision. Same-status provider polls preserve readiness.
Keep `verification` bounded to the latest request/decision, with server-only actor references.

`VerificationControl` and toolbar `CommentVerification` share pure `@uier/toolbar/verification`
labels/types, not UI or runtime imports. Ready is a subset of Open in activity counts; board
columns are exclusive. Reject sets In progress, confirm clears it, and cancel takes an optional
`status` target (else the thread keeps its flag and returns to where it was). Workflow-only changes must not acknowledge reads. MCP offers approved
request/cancel under `feedback:status`, never confirmation. Keep tools, workflows and downloadable
skill aligned. Focused coverage is `verification{,.api}.spec.ts` plus bulk, MCP and integration
regressions. Author placeholder deletion redacts verification with original author evidence.

## Project opt-in

`DbProject.verificationEnabled === true` enables the process; missing or false means off for both existing and new projects. No migration enables it. Admins change **Enable fix verification** in Project settings → Review, using the existing Save/Discard form. Older forms preserve the setting. Both the action and persistence service validate it.

Turning it off leaves stored requests and history intact. Pending threads display as Open or In progress according to the retained progress flag, including custom status fallbacks, lists, boards, My work, query predicates/counts, toolbar activity and MCP packets. They remain reachable by their original link and can be marked Done without reviewer confirmation. Re-enabling resumes still-pending requests; an ordinary status write ends a pending request normally. There is no bulk rewrite or artificial confirmation.

While off, Ready and custom Ready statuses are hidden from project workflow editors, board columns, menus and filters. Workspace definitions retain all five categories for projects that opt in. Authorized workflow discovery omits Ready definitions. All request/confirm/reject writes recheck the current project setting inside each conditional attempt and refuse with instructions to mark the comment done instead. Cancellation remains available to legacy authorized callers; the disabled UI offers ordinary completion. Queued request emails are suppressed while off. Existing confirmations remain historical records.
