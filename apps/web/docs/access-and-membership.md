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
  suggests. Every uier account email is proven (email code or link, invitation link, or Google's verified
  address for Gmail and the account's own Workspace `hd`), so the account email is the verified email; never
  match on a provider claim that did not create or prove the account. Public providers (`isPublicEmailDomain`:
  the welcome step's personal providers plus shared inboxes) are refused for adding and ignored at sign-in.
- **Matching** is exact on everything after the last `@`, lowercase ASCII (`emailDomainSchema`). No suffix or
  parent matching: a subdomain is its own domain and needs an admin with an email there.
- **Records:** `workspace-domain` (`domain_<domain>`, the source of truth, written only through `mutateAccess`
  with a `domain.added` / `domain.updated` / `domain.removed` event) and the lookup `domain-workspace`
  (`domain:<domain>` partition, id = workspace id), which counts only while its workspace record exists. Add
  writes the lookup before and after the transaction; remove deletes it after, then recreates it when the
  domain was added again meanwhile. Several workspaces may offer one domain; at most `MAX_WORKSPACE_DOMAINS`
  per workspace, and a sign-in looks at `MAX_DOMAIN_WORKSPACES`.
- **Sign-in:** every sign-in path (email code and link, passkey, Google, Microsoft) redirects through
  `signInDestination`, which sends the account to `/app/join?next=<where it was going>` when
  `hasDomainJoinOffer`; a failed lookup only logs. Invitation acceptance does not. The join page reads only the
  session user (no `getAppContext`, so a new account gets no own workspace before it chooses) and shows the
  workspace name, the domain and the adding admin's name while they are a member: nothing else of the workspace.
  "Not now" and Join continue to `joinNextPath(next)`, never back to the join page.
- **Joining** (`joinWorkspaceByDomain`) rechecks everything in the access transaction: the domain record, no
  membership, and a recipient generation of 0 (`access-generation` of the address: no invitation was ever
  sent and no removal made there, so a removal is never undone and a pending invitation is accepted from its
  link). The person becomes a commenter with no direct projects, the domain's teams that are still active at
  their chosen generation (`currentDomainTeams`; an archived and restored team does not return) and the
  Internal label, in a `member.joined` event with themselves as actor. Joining twice changes nothing.
- Removing a domain stops new joins at once and leaves members who joined. The stored admin role check, the
  public workspace guard and every rule above have tests in `e2e/workspace-domains.api.spec.ts`;
  `workspace-domains.spec.ts` (full suite) adds the domain, joins from a new account and checks Activity.
