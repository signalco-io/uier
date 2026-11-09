# Workspace access and membership

Teams use `src/lib/app/access.ts` / `accessRules.ts` for additive, current workspace/project
authorization. Load one workspace team snapshot for list operations; never revive the old
direct-only predicate or copy inherited grants into a member's direct list. All access writes
go through `mutateAccess` and `AppStore.transact` (workspace revision guard + mutation + 180-day
event). Recheck admin/target/team ownership on retries. Member removal and invitation acceptance
use the same guard; acceptance consumes the workspace invitation atomically, not just its lookup
token. Team archive clears projects and invalidates earlier team invitations; restore starts
empty. Keep public-workspace safeguards and guest/private-thread distinctions. New app routes
are `/app/workspace/teams`, `/app/workspace/teams/[teamId]`, `/app/workspace/users/[userId]`. Admin previews must reject stale
revisions. See [teams and access](../../../docs/teams-and-access.md) for limits, history, erasure,
Session-consistency limits, real preview Cosmos checks and rollback.

- Apart from uier's own public feedback project, which every account joins (`joinPublicProject`), a
  membership is only ever created by an invitation, by the person's own click on a workspace that offers
  their email domain ([email domains](#email-domains)), or together with a new workspace (`ensureOwnWorkspace`
  or `createWorkspace` from the workspace menu, one `createAll` transaction each; at most
  `MAX_CREATED_WORKSPACES` per creator). Never recreate a missing member document of a customer workspace: a missing
  member is someone an admin removed, and recreating it undoes the removal (their review tokens, MCP access
  tokens and connected apps work again). `e2e/workspaces.api.spec.ts` and the users e2e tests cover it.
  Member removal uses `mutateAccess` / `AppStore.transact` to conditionally update the workspace
  access revision, delete the versioned member, invalidate old invitations and append its event.
  Read the workspace before counting admins and repeat both on a conflict; never undo a removal
  by recreating its member document. `replaceAndDelete` remains available for older callers.

## Email domains

`src/lib/app/workspaceDomains.ts`; Settings → Email domains (`workspace/(tabs)/settings/WorkspaceDomains*.tsx`,
`domainActions.ts`); the join page `(auth)/join/`; `src/lib/app/signInDestination.ts`. Product rules are in
[teams and access](../../../docs/teams-and-access.md#email-domains).

- **Verification:** an admin adds only the domain of their own account email (`addRefusal`), which the section
  suggests. Public providers (`isPublicEmailDomain`: the welcome step's personal providers plus shared inboxes)
  are refused for adding and ignored at sign-in. Never match on a provider claim that did not create or prove the
  account.
- **Fresh email proof** (`src/lib/app/emailProof.ts`): an account email is proven once, but its owner can lose
  the inbox and keep signing in (passkey, linked Google or Microsoft, an old session). So adding a domain, the
  offer, the join page and joining all need the account email proven by this browser's sign-in within
  `EMAIL_PROOF_SECONDS` (10 minutes). `startSession(userId, method, provenEmail)` puts a keyed hash of the address
  in the session token (`ev`, never the address) and returns the `EmailProof`; `getSessionEmailProof(user)` reads
  it back for that account and email. Proofs: email code or link and invitation link (the account email), Google
  only where `googleIsAuthoritative` for the address it returns in this sign-in (`provenEmail` on `signed_in`; a
  linked account whose Google address moved proves nothing). Passkeys and Microsoft prove none. The library
  takes the proof as an argument (`addWorkspaceDomain`, `hasDomainJoinOffer`, `domainJoinOffers`,
  `joinWorkspaceByDomain`), checks `freshlyProvenEmail` and reads nothing without it. Without a fresh proof,
  Settings shows a "Sign in again" panel instead of Add, and the join page shows a Sign in again card, the same
  whether or not a workspace matches (`signInAgainWithEmailAction` in `shell/actions.ts`: sign out, email form,
  back to `next`). The proxy refreshes the review SSO cookie on every app request, so a failed server action
  refreshes the page: a Join refused for an old proof re-renders as that card, and a refused Add as the panel.
- **Matching** is exact on everything after the last `@`, lowercase ASCII (`emailDomainSchema`). No suffix or
  parent matching: a subdomain is its own domain and needs an admin with an email there.
- **Records:** `workspace-domain` (`domain_<domain>`, the source of truth, written only through `mutateAccess`
  with a `domain.added` / `domain.updated` / `domain.removed` event) and the lookup `domain-workspace`
  (`domain:<domain>` partition, id = workspace id), which counts only while its workspace record exists. Add
  writes the lookup before and after the transaction; remove deletes it after, then recreates it when the
  domain was added again meanwhile. Several workspaces may offer one domain; at most `MAX_WORKSPACE_DOMAINS`
  per workspace, and a sign-in looks at `MAX_DOMAIN_WORKSPACES`.
- **Sign-in:** every sign-in path (email code and link, passkey, Google, Microsoft) redirects through
  `signInDestination` with the proof `startSession` returned, which sends the account to
  `/app/join?next=<where it was going>` when `hasDomainJoinOffer`; without a proof it looks nothing up, and a
  failed lookup only logs. Invitation acceptance does not redirect. The join page reads only the session user
  and its proof (no `getAppContext`, so a new account gets no own workspace before it chooses) and shows each
  workspace's name and the domain: nothing else of the workspace, not even who added the domain. With a fresh
  proof and no offer it continues to `next`. "Not now" and Join continue to `joinNextPath(next)`, never back to
  the join page.
- **Joining** (`joinWorkspaceByDomain`) rechecks everything in the access transaction: the fresh email proof
  (the offer the page showed does not count), the domain record, no membership, and a recipient generation of 0 (`access-generation` of the address: no invitation was ever
  sent and no removal made there, so a removal is never undone and a pending invitation is accepted from its
  link). The person becomes a commenter with no direct projects, the domain's teams that are still active at
  their chosen generation (`currentDomainTeams`; an archived and restored team does not return) and the
  Internal label, in a `member.joined` event with themselves as actor. Joining twice changes nothing.
- Removing a domain stops new joins at once and leaves members who joined. The stored admin role check, the
  public workspace guard and every rule above have tests in `e2e/workspace-domains.api.spec.ts`;
  `workspace-domains.spec.ts` (full suite) adds the domain, joins from a new account and checks Activity.
