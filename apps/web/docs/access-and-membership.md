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

- Direct project/review links resolve each live browser account independently, including its current
  workspace membership and project/team grants. A destination's private comment and admin settings
  checks also apply before that account becomes a choice. Exactly one choice selects its account and
  workspace automatically; several choices use the existing picker. Resolution never combines accounts'
  permissions or authorizes an API read with a parked credential. Missing and inaccessible resources
  expose no account choices; access is rechecked by the switch POST and again by the destination.

Workspace → People (`workspace/(tabs)/users/page.tsx`): the People and Invitations lists are one grid
per card (`columnsGroup`, rows use `grid-cols-subgrid`), so the person, access and actions columns line
up whichever actions a row has (your own row has no Remove). The grid starts at the card's `@2xl`
container width; narrower cards keep the wrapping item row. Keep new row content inside those columns.

- Apart from uier's own feedback workspace, which every account joins as a commenter of the user feedback project (`joinPublicProject`), a
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

Automatically created own workspaces start with the name **Personal**. Existing stored names are
kept, and workspaces created from the menu use the name the person enters.

Browser coverage checks the Personal name when skipping first-run setup and in OAuth consent,
project listings and connected-app access details.

## Access tokens created by a connection

The MCP `create_access_token` tool requires the separately granted `tokens:create` operation.
It selects 1–20 explicit projects in one workspace, rechecks each through `mcpProject` against the
connection's selection and the person's live membership/team access, and permits only operations on
the authenticating connection. OAuth access-token narrowing applies. Issued tokens never include
`tokens:create`, request 1–30 days capped at the creator’s hard expiry, and retain live member/private-feedback checks on use. A token is
independently revocable under Account → Coding agents → Access tokens, with its creator named there.
Revoking an OAuth connection offers to revoke its created tokens too, checked by default; the
grant and selected tokens are removed atomically against the shared creation guard.
See [MCP connector](mcp-connector.md) for atomic audit/retry storage and creation limits.

The access forms have separate client entry modules (`TeamEditor`, `TeamProjectForm`, `TeamLifecycle`,
`BulkTeamForm`, `MemberAccessForm`, `CopyAccessToTeam` and `ProjectAccessButtons`). Pages import only the
forms they render; shared fields, confirmation and impact previews live in their own small modules.
`accessFormData.ts` holds the shared view types and pure current-value projection. Keep server
authorization and revision checks in the actions and services.

The app translates access controls, previews and activity descriptions at presentation time. Stored role/action ids and user-defined names stay unchanged. `describeAccessEvent` receives the request translator and language; list conjunctions use `Intl.ListFormat`, and management counts use `Intl.PluralRules` (including Croatian one/few/other). Its default English formatter remains available to API/export callers. `management-language.api.spec.ts` covers names and count forms.
