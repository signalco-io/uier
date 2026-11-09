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
