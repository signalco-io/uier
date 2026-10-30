# Teams and project access

Teams are flat, admin-managed groups inside an existing workspace. A person and a project can
belong to several teams. The workspace remains the data boundary; client labels are metadata.

## Everyday use

Workspace admins open **Teams** in the sidebar. The directory searches normalized names and
paginates active or archived teams on the server, 20 at a time. Team details contain People,
Projects and Activity. Names are whitespace-normalized, case-insensitively unique and reserved
while archived. Descriptions are plain text. New teams start with no people or projects.

Add accepted workspace members without sending another invitation. Bulk changes support up to
50 people, save separately per person and report each result. The explicit **Create from existing
access** helper creates a team from selected people/projects and keeps direct grants. Removing
those direct grants requires a separate confirmed change in the person's detail.

**Users** filters accepted people/pending invitations by team, project and Internal/External/
Unspecified relationship. Open **Manage access** for a person's role, relationship, direct
grants, teams and every effective project source. Older memberships display Unspecified; no
email-domain inference is made. The relationship is per workspace and grants no permissions.

Project settings keep **Who can comment** separate from **People and teams**. Share with or
remove a team without copying people into direct access. A person with several grants appears
once, with every current source. **Remove all member access** previews both the direct grant
and every granting team membership, including consequences for other projects. Admins cannot
be excluded from one project. All-project members must first explicitly change their blanket
grant; it is never expanded into a snapshot of today's projects.

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

## Persistence, limits and history

All access data stays in the existing app container and `workspace:<id>` partition:
`team`, normalized `team-name` reservations, optional member/invitation fields,
`access-generation` revocation markers and `access-event` history. Member-held `teamIds` are
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
| Teams per member or invitation | 50 |
| Explicit projects per team | 200 |
| People per bulk operation | 50 |
| Team name / description | 80 / 500 characters |
| Access history | 180 days, server-controlled TTL |

Transactions reject over 100 operations, duplicate item ids, mixed partitions or serialized
payloads above 1,800,000 bytes, leaving space below Cosmos's 2 MB batch limit. Per-person bulk
transactions normally contain three operations (workspace guard, member and event). The team
mutation and before/after arrays remain well below the payload bound at the documented limits.

History is admin-only and paginated on the server. Events include actor, server time, action,
target ids and before/after access metadata; no credentials, tokens, comment text or screenshots.
The privacy policy describes relationship data and 180-day retention. Deleting a project removes it
from team, member and invitation grants through the same guard, in `project.deleted` events
([project deletion](project-deletion.md)). There is no self-service account/workspace deletion flow today. For a verified erasure request, include team/name records,
member/invitation relationships, email-hashed generation records and affected access events in
the existing scoped operator process. For workspace erasure, enumerate all these types in that
workspace partition. For account erasure, remove membership relationships and events where the
account is actor/target, considering other people's retained records. Do not erase a revocation
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
