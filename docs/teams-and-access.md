# Teams and project access

Teams are flat, admin-managed groups inside an existing workspace. A person and a project can
belong to several teams. The workspace remains the data boundary; client labels are metadata.

## Everyday use

Workspace admins open **Workspace** in the sidebar, then its **Teams** tab. The directory searches normalized names and
paginates active or archived teams on the server, 20 at a time. Team details contain People,
Projects and Activity. Names are whitespace-normalized, case-insensitively unique and reserved
while archived. Descriptions are plain text. New teams start with no people or projects.

Add accepted workspace members without sending another invitation. Bulk changes support up to
50 people, save separately per person and report each result. The explicit **Group existing
people** helper creates a team from selected people/projects and keeps direct grants. Removing
those direct grants requires a separate confirmed change in the person's detail.

**Users** filters accepted people/pending invitations by team, project and Internal/External/
Unspecified relationship once the list has more than eight people and invitations, and only by what
tells them apart (a filter set in the address always shows, so it can be cleared). The invite dialog
keeps the relationship under **More options**, because it is a label without permissions. Open **Manage access** for a person's role, relationship, direct
grants, teams and every effective project source. Older memberships display Unspecified; no
email-domain inference is made. The relationship is per workspace and grants no permissions.

Project settings keep **Who can comment** separate from **People and teams**, which has **Invite**
with the project already chosen. Share with or
remove a team without copying people into direct access. A person with several grants appears
once, with a badge for every current source: the workspace (Admin, All projects), the project
(Direct) or a team. **Remove** previews both the direct grant and every granting team
membership, including consequences for other projects. For admins and all-project members it
stays disabled, with the reason in its tooltip: admins cannot be excluded from one project, and
all-project members must first explicitly change their blanket grant; it is never expanded into
a snapshot of today's projects.

Confirmations list lost, gained and retained access and the sources that remain. A workspace
access revision rejects a stale confirmation and asks the admin to refresh. A new project is
shared with no team automatically, including teams using the same client label.

## Authorization and privacy

For a current user and membership, on a project in the same workspace, access is the union of:

- Workspace admin.
- Direct **All projects (including future projects)**.
- Direct selected project.
- An active, current team membership with that explicitly selected project.

`src/lib/app/access.ts` loads at most 101 active-team records in one workspace query, rejects a
limit violation and supplies the pure rules in `accessRules.ts`. List operations reuse this
snapshot across projects/people. The server never trusts submitted team ids as authority and
stores no permission snapshot in a cookie, review token, MCP access token or connected app. Storage failures
propagate as errors; they cannot become a blanket grant. There is no process-wide positive
authorization cache. The old direct-only predicate has been removed from all consumers.

This applies to app visibility/Clients, review redirects and codes, bearer tokens and session
bridges, comments/evidence/context, participants/mentions/assignment, read activity, notification
eligibility and MCP. Optimistic comment, screenshot and anchor mutations recheck member access
on retries. Private-thread author/admin checks remain separate: being in the same team never
makes another person's private thread visible. Assignment cannot recover lost project access.

Team membership alone does not follow every thread. Notification discovery deduplicates
recipients and delivery rechecks current access and private visibility. MCP access tokens remain
limited to their original selected project ids/scopes intersected with current access; connected
apps (OAuth) store only the chosen workspaces, projects and scopes and intersect them with current
access on every request.

Guest-link visitors have no team membership. External reviewers are authenticated commenters;
an admin invites their email with selected teams and optional direct projects. The invitation
defaults to External, Commenter and no blanket grant. Admin/all-project choices carry a visible
warning. Visitor feedback, screenshots and read history are never transferred to an account by
matching a name or email. Guest DTOs contain no team, roster or relationship metadata. Non-admins
get safe not-found responses for guessed team/person URLs; Account shows only their own team
names and accessible projects. The public uier workspace has no team administration.

## Invitations and lifecycle

Invitations retain their seven-day, single-use behavior and 50/workspace/day email budget.
Resending replaces the old invitation. Acceptance rechecks the workspace, role, recipient
revocation generation, issuing admin (for team invitations), current team state and project
ownership. It uses current project selection, not a copy from send time. Existing members keep
unrelated direct grants/teams and the higher role. A team-only link with no available teams is
unavailable; remaining valid direct/team grants can still be accepted.

Offboarding conditionally deletes the membership and increments an email-hashed revocation
generation in the same workspace transaction. Older invitations to that address and team
invitations issued by a removed admin become invalid immediately in authoritative storage.
Issuing-admin role checks also reject team invitations after demotion. New invitations capture
the new generation. Reinviting restores only newly approved grants; dangling historical team
ids do not reappear. Self-removal and the last-admin safeguard remain enforced.

Archiving clears all project grants and increments the team's invitation generation in that
transaction. Restoration starts with no grants and does not revive old invitations. Deletion
releases the name reservation and leaves a non-granting id tombstone; ids are never reused.
Membership references/history remain available to admins. People, projects, authored feedback,
evidence and read cursors are not deleted by team lifecycle changes.

Revoking managed member access does not revoke a public guest link. A removed person can use
a guest identity where the project allows it, under the existing guest policy. Data already
delivered to a browser or email cannot be retracted.

## Email domains

For company workspaces, an admin can let colleagues join without an invitation each. In
**Workspace → Settings → Email domains**, an admin adds the domain of their own email (the section
suggests it: `example.com` for `ada@example.com`) and, optionally, teams that people who join get.
After that, anyone who signs in to uier (or registers) with an email at that domain, in a way that
confirms the address, sees a **Join your team** page listing the workspace, and joins with one click.
**Not now** continues where they were going; the page comes back at their next such sign-in.

- **Verified domains only.** The adding admin's own account email must be at the domain. uier only
  creates accounts for proven addresses (an email code or link, an invitation link, or Google's
  verified address for Gmail or the account's own Google Workspace domain), so an unverified address
  never matches. A DNS record check is not offered: it would let admins with a personal email add a
  company domain, at the cost of a pending state, DNS lookups and a re-check policy. An admin with an
  email at the domain can add it instead.
- **Fresh proof of the inbox.** An account email is proven when the account is created, but people
  lose inboxes (they leave the company) and can still sign in with a passkey, a linked Google or
  Microsoft account or an old session. So adding a domain, seeing the offer and joining all need a
  sign-in from the last 10 minutes that confirmed the address now: an email code or link, an
  invitation link, or Google returning the address for its Google Workspace domain. Passkey and
  Microsoft sign-ins confirm no address: they get no join page. Without such a sign-in, Settings and
  the join page offer **Sign in again** with an email code. Joining is checked again when the person
  clicks, not only when the page showed the workspace.
- **Public email providers are refused** (gmail.com, outlook.com, yahoo.co.uk, proton.me, shared
  inboxes and the like): anyone can have an address there.
- **Exact matching.** `example.com` matches `maya@example.com` only: never `maya@eu.example.com`,
  `maya@example.com.evil.test` or `maya@myexample.com`. Add subdomains separately, by an admin with an
  email there.
- **Several workspaces may offer one domain.** Each is listed on the join page and joining stays the
  person's choice, so nobody can claim a company's domain away from its other workspaces, and nobody
  is added to a workspace they did not pick. The join page shows only the workspace name and the
  domain; nothing about people (not even who added the domain), teams or projects reaches anyone
  before they join.
- **What they get:** the Commenter role, the domain's teams that are still active (an archived team is
  skipped; a restored one has to be chosen again), no direct projects and the Internal label. Admins
  can then change their access like anyone else's. Admin access is never granted through a domain.
- **An admin's decision wins.** People already in the workspace see nothing. Someone who was invited to
  it (pending, expired or revoked) or removed from it gets no offer: they need a new invitation, so a
  removal is never undone by a domain and a pending invitation is accepted from its link.
- **Removing a domain** (any admin) stops new joins at once. People who joined stay. Changing a
  domain's teams applies to people who join afterwards.
- **Activity** records `added the email domain example.com`, `changed the teams for example.com`,
  `removed the email domain example.com` and, with the person as actor, `joined through example.com as
  a commenter`, with the teams.

## Persistence, limits and history

All access data stays in the existing app container and `workspace:<id>` partition:
`team`, normalized `team-name` reservations, optional member/invitation fields,
`access-generation` revocation markers, `workspace-domain` email domains and `access-event` history.
Each email domain also has a `domain-workspace` lookup in the `domain:<domain>` partition (id: the
workspace id), which sign-in reads; it matches only while the workspace's `workspace-domain` exists. Member-held `teamIds` are
the only authoritative membership list; no team-held member roster or asynchronous fan-out
grants exist. Optional fields keep existing memberships and invitations backward compatible.

`AppStore.transact` supports conditional create/replace/delete batches in Cosmos and memory.
Every access mutation rechecks the acting admin and target records on bounded retries, then
conditionally updates the workspace access revision, changed records and access event together.
Invitation acceptance consumes the workspace invitation in the same transaction as its grants;
the cross-partition token is only a lookup and cannot replay a consumed invitation. A racing
member addition cannot recreate an offboarded membership.

Technical abuse/storage bounds in `limits.ts`, independent of pricing:

| Bound | Limit |
| --- | --- |
| Active teams per workspace | 100 |
| Email domains per workspace | 10 |
| Workspaces one sign-in looks at for its email domain | 20 |
| Teams per member or invitation | 50 |
| Explicit projects per team | 200 |
| People per bulk operation | 50 |
| Team name / description | 80 / 500 characters |
| Access history | 180 days, server-controlled TTL |

Transactions reject over 100 operations, duplicate item ids, mixed partitions or serialized
payloads above 1,800,000 bytes, leaving space below Cosmos's 2 MB batch limit. Per-person bulk
transactions normally contain three operations (workspace guard, member and event). The team
mutation and before/after arrays remain well below the payload bound at the documented limits.

History is admin-only and paginated on the server. The workspace area's **Activity** tab and each
team's page show it as sentences ("Maya invited client@example.com to Acme shop"): people, teams and
projects by name, a pending invitation by its address and an accepted one by who accepted it. Ids
that no longer resolve read as "someone", "a team" or "a deleted project", never as raw ids. Events include actor, server time, action,
target ids and before/after access metadata; no credentials, tokens, comment text or screenshots.
The privacy policy describes relationship data and 180-day retention. Deleting a project removes it
from team, member and invitation grants through the same guard, in `project.deleted` events
([project deletion](project-deletion.md)). Transferring a project to another workspace removes its
grants in the old workspace the same way (`project.transferred-out`) and writes it into the new one
without grants (`project.transferred-in`); both events carry the project's name, since it is gone from
one of them ([project transfer](project-transfer.md)). There is no self-service account/workspace deletion flow today. For a verified erasure request, include team/name records,
member/invitation relationships, email-hashed generation records and affected access events in
the existing scoped operator process. For workspace erasure, enumerate all these types in that
workspace partition, and delete the `domain-workspace` lookup of each of its `workspace-domain`
records. For account erasure, `workspace-domain.addedBy` holds the adding admin's user id. For account erasure, remove membership relationships and events where the
account is actor/target, considering other people's retained records, the account's `passkey`
documents in `user:<id>` with the `passkey-credential` lookup of each (`passkey:<SHA-256 of the
credential id>`), and its profile picture: the `user-avatar` document (`avatar_<version>`) in
`user:<id>`, which `removeUserAvatar` deletes together with the user's reference
([profile pictures](api.md#profile-pictures)). Do not erase a revocation
marker while outstanding invitations it invalidates remain. Keep backup retention rules intact.

## Verification and operations

While implementing, run typecheck and the relevant `teams.api.spec.ts` / `teams.spec.ts` cases.
After refreshing the production build, use `--project=API` for the API file, or
`PLAYWRIGHT_FULL=1` with `--project="Desktop Chrome" --retries=0` for the browser file. Include
Mobile Chrome for touch or responsive changes. See the [focused test commands](development.md#while-implementing).
Run the short `pnpm typecheck && pnpm build && pnpm test` checks before a code PR; team changes
do not automatically require a full regression run. Related coverage lives in the
workspace/users/review/notifications/MCP suites. Browser
coverage exercises team-only invitation, revocation, archive/empty restoration, safe tenant
boundaries, light/dark axe scans, keyboard dialog focus and Mobile Chrome's 375 px layout.

The opt-in real Cosmos check is fixed to `uierdata/app-preview` and uses disposable random test
partitions. Supply `UIER_COSMOS_TEST_ENDPOINT` with an authorized Azure CLI identity, or supply
`UIER_COSMOS_TEST_CONNECTION_STRING` through the environment. Never print credentials or place
them in files. Run `pnpm -C apps/web exec playwright test e2e/teams.api.spec.ts --project=API`
directly so the test process receives that environment; the root Turbo command intentionally
does not forward these credentials. Without either variable that one
integration test is explicitly skipped. It tests mixed-batch rollback/readback and uses two
independent Cosmos clients for an observed revocation sample. Its attachment records latency.

The deployed account is configured for **Session** consistency. A write is authoritative when
its conditional transaction commits, and subsequent authorization always reads storage.
Independent sessions do not inherit the writer's session token; an observed fast readback is
not a global revocation bound. Do not claim linearizable cross-instance revocation or retract
in-flight responses. Changing the account's consistency configuration is outside this feature.

The 100-team/1,000-project fixture attaches query counts and direct-only/team-resolution latency.
The team query remains one partition-scoped query; it never truncates active teams or queries a
team per project. Record the final local, real-Cosmos and deployed smoke results below before
closing the acceptance umbrella. A local test is not a deployed smoke test.

### Rollout and rollback

Ship authorization consumers and team UI together. No migration, automatic team or grant copy
is required. In a deployed preview, use separate admin/external accounts to invite a team-only
reviewer, check an allowed/foreign project and private evidence, create a narrowly scoped MCP
credential, then remove the final grant and retry the same tokens. Verify queued email is
suppressed and restoration starts empty. Inspect independent-instance readback separately.

Before rollback, inventory team-only members and selected team projects and review the expected
loss of access. An older binary ignores team fields and removes team-only access. Do not silently
materialize team grants into direct lists: that can preserve access after offboarding or broaden
it during later changes. Prefer a forward fix. Any emergency direct grants must be individually
reviewed and confirmed, logged and subsequently reconciled. Keep new records/history during a
binary rollback; do not restore stale membership or invitation snapshots over current grants.
Older invitation handlers also ignore revocation generations. Before serving an older binary,
review and invalidate outstanding invitation records/tokens so an old link cannot undo
offboarding. Reissue approved invitations after the supported handler is restored.

### Evidence

29 October 2026, after integrating main's server-input/access hardening:

- `pnpm typecheck` and `pnpm build` passed.
- `PORT=4356 pnpm test` passed 751 tests with no failures or retries. The one opt-in Cosmos
  test was skipped in that credential-free run and passed in the separate focused run below.
- The focused Teams API run passed 12 tests, including a real Cosmos preview-container check
  for mixed transaction rollback on duplicate/missing/ETag-conflicted records and independent
  client readback. The independent client observed revocation in 196 ms in this sample. This
  is an observation under Session consistency, not a global propagation guarantee.
- The local in-memory 100-team/1,000-project fixture used one bounded team query: 2.4 ms to
  load, 11.6 ms to resolve 1,000 team-access checks, 0.135 ms for direct-only checks. Test
  attachments preserve the measurements; these numbers are not production latency claims.
- A maximum-field serialized fixture measured 7,616 bytes for a 200-project team and 21,906
  bytes for a conservative combined guard/team/event transaction (three operations). Its
  deliberately oversized combined event was 13,626 bytes. These fit well below the 1.8 MB
  application batch guard and Cosmos's 2 MB item/batch bounds.
- Hosted multi-account smoke passed on the [PR preview](https://uier-f7v9f3ig8-signalco.vercel.app):
  team-only external invitation/acceptance, assigned-project access, other-client/admin-directory
  denial, archive revocation with the same session, empty restoration and team deletion. This
  preview contains feature commit `994f0827`; the later search-field width fix passed typecheck,
  build and both Desktop/Mobile Teams browser tests locally.

The full-suite and deployed-preview results are recorded in the pull request. Deployed smoke
testing remains separate from local checks and the account's consistency guarantees. No
production data migration is needed or performed by this feature.

Fix verification stores requester, requested reviewer and latest decision actor references in
the comment partition. Include those references in verified account-erasure/operator cleanup,
with activity/event recipients and existing author/assignee references. Revoke membership first;
removed members cannot decide, while display names follow existing Former member behavior.
Redact or remove affected latest requests/decisions rather than retaining an identifiable
confirmation claim. Whole-thread/project deletion removes the record through existing cleanup;
a deleted author placeholder also drops verification evidence. There is no separate history table.
