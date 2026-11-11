# First run, onboarding and installation

The comments-off case in `e2e/project-review.spec.ts` checks the onboarding and empty-list
notices and their Settings links, then the saved Comments off choice in Review settings.
Each page keeps its accessibility checks and must offer neither Invite nor guest links.
The admin invite helper in `e2e/support/app.ts` hovers the header's access link to open its
popover before choosing Invite; clicking that link navigates to Review settings.

- **First run.** A new user (`findOrCreateUserWithStatus`) has `welcomePending`. Email sign-in without `next`
  goes straight to `/app/welcome` (`(auth)/welcome`), and `/app` sends there too while it is set. The step
  suggests a name (`nameFromEmail`) and, for the workspace made for the account (`welcomeWorkspace`; none after an
  invitation), its stored name (Personal for a newly created workspace) (`src/lib/app/welcome.ts`). Continue validates
  both before saving (`renameWorkspace`, then `finishWelcome` with the name); Skip only clears the flag. Never
  show it to existing accounts (they have no flag) and never rename a workspace the user did not get at sign-up.
  `e2e/support/app.ts` `signIn()` skips it unless `{ welcome: 'stay' }`; `welcome.api.spec.ts` covers the rules.
- **Onboarding.** `OnboardingSteps` shows Your site, Add the script, Check installation and Invite a reviewer;
  once the project exists, every step after the site is a link. `install?onboarding=1` shows one step per
  screen in an `OnboardingStepCard` (`&step=check` is `InstallationCheckStep`, `&step=invite` is
  `InviteReviewerStep`) with Back, Skip setup (to the comments) and Next, Finish on the last step. Keep one
  primary button per step: Next, Check installation until the site is confirmed, Invite for admins of an
  invited-only project. Invited-only projects
  use the shell's `InviteButton` with `projectId`, gated by `context.isAdmin`; the empty comments list does
  the same. Guest projects reuse `GuestReviewLinks` for every configured address in order (main site first),
  in onboarding or the header's access popover (`ProjectAccessInfo`), never again in its empty state. Copy fields use
  plain `reviewUrl` links, never `/app/review`, `uier-token` or `uier-check`. Comments-off states explain that
  comments are off and link admins to Settings → Review; their header popover has no Invite. `inviteAction` still checks the
  admin role on the server. `e2e/app.spec.ts`, `project-review.spec.ts` and `users.spec.ts` cover these paths.

- `InstallationCheck` checks the actual configured site through a nonce/window/origin-bound browser handshake.
  Script/API configuration, comments reads and browser verification must succeed before confirming. Missing evidence
  is inconclusive. Do not replace this with a server fetch/proxy or add test comments. Advanced headers stay in `InstallGuide`.
- `integration.ts` owns default and pinned HTML/Next.js snippets from `@uier/toolbar/bundle`.
  `InstallGuide` offers both with the update/support policy. Constructed review sheets remove
  `unsafe-inline` from its style CSP sources. `scripts/toolbar-assets.mjs` publishes identical
  default/content-addressed loader bytes and the content-addressed review script, checks and retains
  both assets for one year after last release as current; deployment builds carry forward the
  verified uier.io archive. New and retained bundles share a 1,000,000-byte uncompressed size limit.
  Keep the manifest no-store and content-addressed JavaScript immutable with anonymous CORS.

The new-project steps, installation diagnostics and platform instructions follow the app language. Platform/product names and code snippets remain unchanged; only their surrounding guidance is translated. The saved toolbar language is independent of the app language.
