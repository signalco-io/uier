# uier's feedback projects

uier's workspace has two projects for feedback on uier itself. `uier00000001` (uier.io public feedback,
`access: guests`) holds guests' feedback and the starter threads. `uier00000002` (uier.io user feedback,
`access: invited`) holds feedback from signed-in accounts, the app's Give feedback included; every thread
there is private to its author and the staff. `isUierFeedbackProject` applies the shared rules to both
(no integrations, owner email or MCP push, visitor limits with three times the new comments for
accounts). On uier's pages `commentsApiHandler` gives a signed-in account the user feedback project as its
context and the public project as `publicFeedback`: lists, activity, read state and realtime combine both,
`commentContext` finds a thread by id in either, and the account uses the public project as a guest under
`user:<id>` (only staff are its members). Provisioning moves threads accounts started in the public
project once (`user-feedback-split-v1`), keeping ids and numbers; it runs before an instance serves comments
so new threads in the user project number after the moved ones.

Every account joins `w_uier_public`. Only normalized, valid addresses from the server-side
`UIER_STAFF_EMAILS` allowlist become admins with all projects; everyone else is a commenter scoped
to `uier00000002`, including hand-set admins. Provisioning backfills accounts with a durable receipt,
but resets stored admins on every instance's first `ensurePublicProject` call. Sign-in and app
requests reconcile memberships without invitations. `getAppContext` and `memberActor` enforce the
current allowlist at read time too, including old review tokens and MCP connections. Missing/empty
configuration means no staff; malformed entries are skipped using `emailSchema`. Preserve the
selected workspace and personal onboarding. The public workspace has no Users page, invitations,
member removal or project creation; both projects' settings are fixed, with personal email preferences
still available. Enforce this in services as well as the UI; earlier invitations cannot assign roles.
Keep all ordinary workspace behavior unchanged. Admin author filtering uses `app/commentAuthors.ts`:
random, account/project-bound references expire after 24 hours, and stored author ids never cross
the client boundary. `CommentsStore` matches both openers and remaining replies before list limits.
App reply deletion reuses `deleteProjectCommentItem`; thread deletion must keep screenshot cleanup
and never delete sequence or rate-limit documents (only project deletion removes the sequence). On the public project's
same-origin comments API, `__Host-uier_session` takes precedence over guest identity. Store `user:<id>` just
as the review API does, resolve current account names for DTOs, and keep private app feedback
author-only in the public API. Read the current public project and apply `assertCanUseComments`
on every showcase request; the cached provisioning result is not current access policy. Listing,
activity and both read routes share `comments/visibility.ts`, including legacy `/app` threads
without a private flag. Migration marks copied `/app` threads private. Guest comments are not
automatically reassigned on sign-in.

The app's on-demand feedback toolbar keeps its host and pill across client navigation, including
Account sections. Its page-specific composers reset while saved drafts remain scoped to their
original page. See [client navigation continuity](app-shell.md#client-navigation-continuity).
