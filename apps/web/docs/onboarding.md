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
- **Files only.** On Create project, choose Files only and enter a name. The project opens its
  [file library](proof-viewer.md). Installation shows the first-site setup until an admin adds an
  address in Environments. Website setup still starts with the address and script.
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
  is inconclusive. Installation browser tests wait for a terminal result within the app's 30-second
  handshake budget (plus scheduling margin), then require success; popup creation alone is not readiness.
  `installation.spec.ts` delays a real verification response beyond five seconds to cover cold/loaded runs.
  Do not replace this with a server fetch/proxy or add test comments. Advanced headers stay in `InstallGuide`.
- `integration.ts` owns default and pinned HTML/Next.js snippets from `@uier/toolbar/bundle`.
  `InstallGuide` offers both with the update/support policy. Constructed review sheets remove
  `unsafe-inline` from its style CSP sources. `scripts/toolbar-assets.mjs` publishes identical
  default/content-addressed loader bytes and the content-addressed review script, checks and retains
  both assets for one year after last release as current; deployment builds carry forward the
  verified uier.io archive. New and retained bundles share a 1,000,000-byte uncompressed size limit.
  Keep the manifest no-store and content-addressed JavaScript immutable with anonymous CORS.

The new-project steps, installation diagnostics and platform instructions follow the app language. Platform/product names and code snippets remain unchanged; only their surrounding guidance is translated. The saved toolbar language is independent of the app language.

On Projects → Create project, `NewProjectHeader` and `OnboardingSteps` reuse the already-selected
client language, so the instructions and progress appear before the form's authorized workspace reads.
The form is in the page's shell too (`NewProjectForm`, one mounted instance): the addresses and the name need no
data, so they can be typed at once and stay as typed. What reads the request streams into it through two slots, each
behind its own boundary and both from one read (`loadNewProject`, React `cache()`), which keeps the admin and
public-workspace checks and the existing project/client sources and caches no suggestions: the client field's control
(`NewProjectClient`; a workspace with clients gets another control than one without, so until then it is an outline
behind the form's one status, "Loading the form") and the button (`NewProjectSubmit`, disabled until the page has
authorized the person; the action authorizes again). Completed form markup and the
max-width container are unchanged. The production-build instant suite covers empty workspaces and
existing client suggestions on desktop, mobile and tablet, typing an address under the lock and finding it after
release; ordinary onboarding tests still exercise
creation and all installation steps. Direct loads retain the outer request-language shell.

The install steps load the same way ([loading states](../../../docs/design/loading-states/README.md), 10). The step
list is the install page's shell (`InstallFrame`, outside its data boundary): it reads the project, `onboarding=1` and
the step from the address (`useParams`, `useSearchParams`), so it is there at once, moves with the click and stays
mounted when the step arrives. Each step loads as its own card (`InstallStepLoading`, "Loading this step"): the
title, the explanation and Back, Skip setup and Next are real, working links, and outlines stand where the project
goes (the script, the platforms' instructions, the site to check). The last step's explanation, its content and
whether Finish is the primary button depend on who can comment, so those are outlines (`OnboardingStepCard` without
`next`). `ScriptDescription` is a client component for this, shared with the install guide. `InstallLoading` is the
frame and the step together, for a project entered on its install page (`ProjectLoading`), where the Install tab is
current at once when the shell knows of no comment. Without `onboarding=1` the page only
redirects, and shows one section outline meanwhile.
