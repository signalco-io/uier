# uier's public feedback project

Every account joins `w_uier_public`. Only normalized, valid addresses from the server-side
`UIER_STAFF_EMAILS` allowlist become admins with all projects; everyone else is a commenter scoped
to `uier00000001`, including hand-set admins. Provisioning backfills accounts with a durable receipt,
but resets stored admins on every instance's first `ensurePublicProject` call. Sign-in and app
requests reconcile memberships without invitations. `getAppContext` and `memberActor` enforce the
current allowlist at read time too, including old review tokens and MCP connections. Missing/empty
configuration means no staff; malformed entries are skipped using `emailSchema`. Preserve the
selected workspace and personal onboarding. The public workspace has no Users page, invitations,
member removal or project creation; public project settings are fixed, with personal email preferences
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
