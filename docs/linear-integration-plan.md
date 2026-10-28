# Linear integration: implementation plan

Status: adapter and project settings implemented. Provider registration and hosted acceptance remain manual release gates. This document retains the original design and proposed phases; [the implemented contract](integrations.md), [setup](integration-setup.md) and [operations](integration-operations.md) describe the current code and limits.

Depends on the shared integration foundation in [the Notion plan, section 2.1](notion-integration-plan.md#21-expansion-to-other-services). The shared foundation is implemented. The [GitHub](github-integration-plan.md) and [Slack notifications](slack-integration-plan.md) plans are separate adapters.

## 1. Goal and scope

A uier workspace admin connects a project to one Linear team and optionally a project within that team. After the admin saves the destination and turns sending on, each eligible uier thread becomes one Linear issue. Later source changes converge its title, description, mapped state and discussion. uier remains the source of truth; Linear is a one-way mirror.

Default: automatic mirroring of new and changed non-private threads, without importing old threads merely because a connection was enabled. An explicit backfill sends at most the newest 1000 eligible threads. This is a proposed product default, not existing behavior. All uier feedback kinds are eligible initially; a kind filter requires an explicit later design.

Ships in phases: OAuth app installation; team/project and workflow-state selection; issue creation and updates; privacy/deletion cleanup; discussion; member-only external links; bounded backfill. Screenshots have their own later phase and data-transfer copy.

Non-goals: inbound edits, webhooks, agent sessions, Linear-to-uier assignment, importing existing Linear issues, cycles, estimates, priority inference, creation of teams/projects/states/labels, sending private threads, copying secrets into descriptions, or sending from a request path. Closing a uier project or disabling comments does not close every Linear issue.

## 2. How it works

The shared mutation hooks mark `syncVersion` and `syncPending` once. Shared discovery creates a `linear-sync` ledger for the bound connection alongside any Notion, GitHub or Slack work, then clears the source flag only after every target is queued. Linear never owns that acknowledgement.

```text
uier mutation -> shared pending signal -> ledger per bound connection
                                          |
                          linear-sync lease + current access check
                                          |
                projectFeedbackExport -> pure Linear projection
                                          |
                 persisted operation -> GraphQL -> saved result
                                          |
                         externalLinks[] entry for members
```

Reuse `apps/web/src/lib/review/feedbackContext.ts` and `@uier/toolbar/feedback-context`; do not construct an export from raw comment documents. The current service reloads saved feedback and protected screenshot availability under the supplied actor. The worker adds the actor-independent private-thread check before calling it.

Add `apps/web/src/lib/integrations/linear/{config,client,oauth,connection,destination,issue,transport,delivery,view}.ts`. Register `linear` only when its production adapter and settings ship. The shared core owns discovery, leases, attempt persistence, deadlines, retry scheduling and link loading. The adapter owns Linear queries, projection, reconciliation and error classification.

## 3. Linear facts the design depends on

The following are verified provider behavior; all implementation choices in later sections are proposals.

- OAuth uses an authorization-code flow, supports S256 PKCE, and issues 24-hour access tokens with rotating refresh tokens. Interrupted refreshes have a documented 30-minute replay grace. Revocation uses `POST /oauth/revoke` with a `token` form field. [OAuth authentication](https://linear.app/developers/oauth-2-0-authentication).
- `actor=app` installs an app identity in a workspace and attributes mutations to it. App installation requires a Linear workspace admin; its `viewer.id` identifies that app user. Team access can subsequently change. uier does not request assignable/mentionable agent capabilities or agent sessions. [Actor authorization](https://linear.app/developers/oauth-actor-authorization), [app authentication and management](https://linear.app/developers/agents).
- The API is `POST https://api.linear.app/graphql` with Bearer authentication. HTTP 200 can contain partial data plus GraphQL `errors`; issue creation and updates return mutation payloads whose success and required entity fields must be checked. [GraphQL guide](https://linear.app/developers/graphql).
- The official SDK schema exposes `IssueCreateInput.id` and `CommentCreateInput.id` as optional UUID-v4 identifiers, issue/comment updates, `commentDelete`, and `issueDelete`. Issue deletion means trash; its permanent-delete option is admin-only. `IssueUpdateInput.trashed` supports trash/restoration. These schema capabilities do not prove that a particular OAuth grant can perform every operation. [SDK schema snapshot](https://github.com/linear/linear/blob/618a737a4e6aa279b7853c650f79f209a5142bbc/packages/sdk/src/schema.graphql).
- OAuth applications have a documented baseline of 5,000 requests/hour and 2,000,000 complexity points/hour per user/app user; individual operations also have limits. A query's maximum complexity is 10,000. Rate-limit responses use HTTP 429, `RATELIMITED` and `Retry-After`; reset headers use epoch milliseconds. [Rate limits](https://linear.app/developers/rate-limiting).
- Lists use cursor connections and support explicit page sizes. Server filtering avoids retrieving an entire organization for local filtering. [Pagination](https://linear.app/developers/pagination), [filtering](https://linear.app/developers/filtering).
- File upload can request a signed upload URL through `fileUpload`, then PUT bytes server-side with the returned upload headers. Stored assets require authentication; embedding a reachable image URL can make Linear ingest it. uier must not expose a protected screenshot to enable that ingestion. [File uploads](https://linear.app/developers/how-to-upload-a-file-to-linear), [file access](https://linear.app/developers/file-storage-authentication).
- Deleted issues remain recoverable in Linear's recently deleted archive for 30 days. That product retention rule does not guarantee removal of notification emails, exports, history, uploads or other recipients' copies. [Issue deletion and archives](https://linear.app/docs/delete-archive-issues).

Before implementation, refresh the schema snapshot and validate the exact selected operations and scope behavior in a dedicated test organization. A schema field is not an idempotency or authorization guarantee.

## 4. Data model

Use the common connection and ledger envelopes from the foundation. Provider-specific records live in the app container; comments receive no Linear-specific properties.

| Document | Partition / identity | Additional fields |
| --- | --- | --- |
| `linear-grant` | `workspace:<uierWorkspaceId>` / `linear_grant_<hash(linearOrganizationId + oauthClientId)>` | Organization id/name, app-user id, authorized-by admin, encrypted token pair, expiry, scopes, generation, refresh lease, grant status |
| `linear-installation-claim` | `linear-installation:<organizationId>` / OAuth client id | Owning uier workspace and grant id; no credentials; unique ownership claim |
| `linear-connection` | `workspace:<uierWorkspaceId>` / opaque connection id | `provider: 'linear'`, project, connecting admin, grant id, team/project ids, destination names, state/label mappings, enabled state, metadata-check date, backfill cursor |
| `linear-oauth-state` | `user:<userId>` / hash of provider, user, workspace and project | Random state hash, encrypted PKCE verifier, intent, expiry; ten-minute TTL; single use |
| `linear-sync` | `linear:<projectId>` / `linear_<hash(connectionId + ':' + projectId + ':' + threadId)>` | Common versions/deletion intent, issue UUID/identifier/URL, destination snapshot, projection hashes, per-item comment UUID/hash map, cleanup state and retired issue generations |

The project binding is `integrations.linear = { connectionId, since }`. Provider-scoped etag helpers merge/remove only that entry. A connection references a shared grant; disconnecting one project must not revoke credentials used by another project.

The common attempt envelope gains Linear details: stable issue/comment UUID, operation kind, through-version, destination revision, plan hash and cleanup cursor. Persist each proposed UUID before the first external create. Retired issue generations keep their destination, reserved issue/comment ids, uncertain attempts and cleanup state; a new visibility generation never overwrites the only record of a former external copy. Ledgers store identifiers and hashes, not feedback bodies, screenshots, tokens, upload signed URLs or raw GraphQL responses.

The installation claim prevents silently adopting a Linear organization's installation into a different uier workspace. Cross-workspace installation sharing and ownership transfer are out of scope. Claim acquisition and callback recovery must be idempotent; a failed callback must not leave a permanent orphan claim.

`LinearConnectionView` is a server allowlist: bounded organization/team/project display names, state mapping choices, enabled/status/code, next retry, last success, backfill counts and review count. It excludes grant ids, token material, app-user ids and connecting-user identifiers.

## 5. Connect and disconnect

Proposed routes: `/app/linear/connect` and `/app/linear/callback` under `apps/web/app/(rest)/(app)/app/linear/`. Add them to `knownPages.ts`. Use the existing session, current workspace and admin checks; reject the public showcase project. A failed session starts again from settings without carrying OAuth code/state through sign-in.

Start requires a same-origin navigation, configured deployment and current project ownership. Store a cryptographically random, provider-bound state hash and encrypted PKCE verifier; use S256 and a plain anchor in a shadcn button so prefetch cannot mint state. Register the exact production callback; previews are unconfigured. No arbitrary callback/return URL comes from the browser.

Use the cited OAuth protocol with `actor=app` and `prompt=consent`. The proposed scope set is `read,write`: the complete mirror needs updates and cleanup of its own discussions, not only creation. Do not request `admin`, agent, customer or initiative scopes. Confirm this scope set against the exact mutation fixture before launch; `issues:create`/`comments:create` alone must not be assumed sufficient for edits/deletes. Broader read/write access is disclosed on the consent/settings screen. [Scope definitions](https://linear.app/developers/oauth-2-0-authentication).

Callback consumes the matching state once, validates the provider/user/workspace/project intent, rechecks admin membership and exchanges the code. Read only organization identity, app-user identity and granted scope metadata; validate every required field before storing a grant. Apply the installation ownership claim. Store a disabled connection without a destination; authorization alone sends nothing.

An existing grant in the same uier workspace is reused by a second project through an explicit destination-selection flow. Do not start another OAuth flow merely to attach a second project. A reconnect replaces a token pair only under the grant's generation guard. Live acceptance must demonstrate how a second authorization of the same organization affects its previous pair; if it disturbs another owner or connection, the ownership/reconnect model must be resolved before release.

Encrypt with AES-256-GCM and a dedicated `LINEAR_TOKEN_KEY`; AAD binds provider, uier workspace, Linear organization and token field. Store expiry from the received token response, not a hardcoded constant. Shared helpers may provide crypto, but a Linear grant is not a Notion connection.

Refresh under an etag lease and generation check shortly before expiry or once after an authentication failure. Persist the refresh attempt identity so a lost response can retry the same refresh operation within the provider's grace; atomically save the new pair, expiry and generation. After the recoverable window, require reconnect rather than guessing. Never log tokens or OAuth response bodies.

Each binding retains `connectedBy` for uier authorization. Removing/demoting that admin disables that binding through `revokeIntegrationGrantsOf`; other bindings may continue only if their own connecting admins remain authorized. Wipe/revoke the shared grant when no authorized bindings remain. Every action and worker attempt also checks membership, covering missed cleanup hooks.

Disconnect removes only the Linear project pointer, suppresses its ledgers/links, and deletes its binding. Issues already in Linear stay there. The final binding disconnect also performs a best-effort grant revocation, then wipes local secrets even if revocation fails. A disconnected installation's copies remain subject to Linear's own controls; no continued synchronization is promised.

## 6. Choosing the team, project and mapping

Load destination metadata in an explicit server action, never at settings render. Query small paginated team, project, workflow-state, label and eligible-user selections; cap each picker at 500 entries and require a narrower search instead of hiding truncation. Names are bounded untrusted labels; saved mappings use UUIDs.

Validate the team belongs to the grant's organization and is currently accessible; an optional project must include that team. Require distinct explicit open and done state mappings from that team's workflow. Do not infer a state from an English name or rely on a provider default. Cache metadata for at most one day and revalidate on save and after relevant errors.

| uier field | Proposed Linear projection |
| --- | --- |
| Title | `context.title`, bounded locally to 100 characters; preserve rewrite labeling |
| First feedback, quote, anchor, source, reproduction | Deterministic issue description from `FeedbackContext` |
| Open/done | Saved `openStateId` / `doneStateId`; no creation of workflow states |
| Kind/environment | Description fields; optional existing label UUID mapping, with no label auto-creation |
| Assignee | Display name in the description initially; optional explicit uier-user → Linear-user mapping later |
| Review link | Packet's approved token-free comment link; omit unavailable source URLs |
| Replies | One app-owned comment per visible saved uier reply in discussion phase |
| Screenshot | Protected-reference note initially; byte upload only in screenshot phase |

Do not match assignees by email/name automatically, infer priorities from the word “bug”, or replace unrelated human labels. Manage only the configured label set. Issue body ownership is explicit: uier may replace its mirrored description on the next source change; human discussion is not overwritten.

The pure formatter reuses the shared feedback Markdown rules: dynamically sized literal fences preserve feedback and quoted text, while trusted section labels remain separate. Escape untrusted display labels and never generate mentions or interpret reviewer text as commands. Verify the actual Linear editor/API rendering with hostile Markdown and mention-like text before launch; a formatter must not turn saved content into an unintended notification.

Save rechecks the schema/mappings and current admin, then enables only this binding. Team/project changes keep the connection identity and start a new external issue generation. Retain prior issue/comment ids, uncertain attempts and their original grant, organization and app-user authority under that continuing binding, so later privacy/deletion can clean reachable old and current copies. Warn explicitly that old issues remain in their former destination until cleanup; this does not migrate those issues. Blocked old copies stay recorded for review while other reachable copies are cleaned. An ordinary sync never retargets a former team's issue into the new destination.

## 7. Sync semantics

The adapter converges current state; it does not replay every intermediate edit. Before each external write, re-read the binding, authorization, source version and private status. Source mutation signals remain the shared ones in the foundation.

| Source change | Proposed Linear operation |
| --- | --- |
| New thread / explicit backfill | Reserve UUID, reconcile it, then `issueCreate` if absent |
| First-message edit, anchor or reproduction change | Update owned title/description only when projection hash differs |
| Resolve/reopen | `issueUpdate` with the mapped state UUID |
| New reply | Reserve/persist comment UUID; reconcile then `commentCreate` |
| Edited reply | `commentUpdate` of the ledger-owned comment |
| Deleted reply / first-message placeholder | Redact/delete the owned reply and rebuild the issue description without deleted evidence |
| Made private or hard deleted | Hide link immediately; scrub owned title/description, delete owned mirrored comments, then trash issue; retain cleanup cursor until acknowledged |
| Visible again | Create a fresh mirrored issue generation; never restore a former issue's old content/history |
| Target issue removed, archived or moved by a human | Pause that ledger for review; do not silently recreate or undo a move/archive |

Every create uses its persisted UUID-v4 id. On a timeout, query that UUID and verify the expected organization, team, app creator and source marker before adoption. For a missing entity, retry only the same UUID; never mint a new one merely because a response was lost. A conflicting entity, inaccessible result or unexplained duplicate is `ambiguous`. The guarantee to prove is one issue/comment under an accepted-but-response-lost create, not “exactly once” based on a schema field alone.

Include a small literal source marker derived from the project/thread or reply id in owned content, clearly identified as uier metadata. Do not rely on Markdown HTML comments surviving Linear rendering. Never adopt by title, email, search ranking or a matching marker alone. New visibility generations receive new reserved ids and retain the old cleanup record.

Normal issue updates overwrite only configured fields; human comments and unrelated labels remain. On privacy cleanup, touch only exact ledger-owned issue/comment identifiers, not every comment authored by the app in the organization. Missing permission is a visible incomplete-cleanup condition. The source tombstone may already be removed after shared fan-out; the ledger's durable deletion intent is sufficient to finish cleanup.

Deleting/trashing is not erasure of history or copies already delivered to people. Never request permanent deletion or `admin` scope. The app-actor cleanup behavior under `read,write`, including owned comments and archived issues, is a release gate tested in a real organization; if it cannot meet the stated scrub-before-trash behavior, revise the feature and copy before enabling it.

Backfill uses the shared connection-specific enqueue helper, newest 1000 eligible threads, 100 queued per run. It can force reconciliation of an already processed version without changing source `syncPending` or notifying Slack/other providers. Its persisted cursor advances only after durable ledger writes succeed; version merging preserves newer changes.

## 8. Delivery worker

Run as an awaited adapter turn in `runIntegrationWorker`, after email in the existing `Review notifications` workflow. No detached promises, browser mutations, per-request sends or separate cron are added initially. Give Linear a proposed maximum five-minute turn, also capped by its fair share of the remaining job budget.

Use a small typed `fetch` client, GraphQL variables, explicit operation names, 20-second request timeouts and response validation. Do not execute user-provided GraphQL. Validate entity ids and constrain external links to verified Linear destinations. Extract safe status/code/reset metadata; raw provider messages and bodies never become logs or user copy.

Pace by shared grant/app-user, not project: proposed defaults are one in-flight call, 250 ms minimum spacing and 100 calls per grant/run. These are conservative application budgets, not provider limits. Track request, complexity and endpoint remaining/reset headers; stop before a budget is exhausted. A provider response governs the next due time even if it exceeds the local backoff cap.

| Answer | Shared result / connection behavior |
| --- | --- |
| Valid payload, `success: true`, required entity confirmed | Accept this step; advance processed version only after the complete plan |
| HTTP 200 with GraphQL errors, partial/missing entity or `success: false` | Classify error; never accept based on HTTP status alone |
| 429 / `RATELIMITED` | Wait without failure count; persist `Retry-After` or relevant reset and pause sibling bindings of the grant |
| Expired access / unauthenticated | One leased refresh and one replay; failed grant becomes `needs_reconnect` |
| Missing team/project/state or forbidden mutation | Pause with bounded destination/mapping/access code; no endless retries |
| Timeout or 5xx after possible mutation | Keep attempt; reconcile UUID or read owned current state before any resend |
| Retryable failure | Shared exponential backoff, at most eight failures, then manual review |
| Binding disabled or admin gone | Wait or suppress as appropriate; no private export or token use |

Turning off a binding pauses all provider calls, including cleanup; keep pending cleanup visible and resume it when sending is turned on. Disconnect ends synchronization and leaves external copies, as stated in the dialog. Linear failure/rate limit cannot consume another adapter's retry budget. Log only provider, ledger id and bounded code plus aggregate counts. Generic retry takes `{ provider: 'linear', id }`; only failed/ambiguous work for that provider is requeued. A privacy cleanup failure remains visible even when its external link is hidden.

## 9. App UI

Add `LinearSection.tsx` under `apps/web/src/components/app/linear/` inside the shared admin-only Integrations group. Use existing shadcn fields, select, button, badges and dialogs; keep server actions in the project action pattern with `adminProject` and `actionResult()`.

Suggested copy: “Send this project's comments to Linear. Private comments are not sent.” Before enabling: “Choose a team, optional project and the states for open and done comments.” Show the grant's organization and destination names, current on/off state, last success, backfill progress, next retry and a bounded review count. Render only `LinearConnectionView`; no network requests happen during settings rendering.

Explain one-way ownership: “Changes in uier update the mirrored issue. Changes in Linear do not update uier.” Disconnect copy states that existing issues stay in Linear. Cleanup copy distinguishes pending, failed and completed trashing and explains provider retention; a green success state must not imply all copies were erased.

The shared loader projects `{ provider: 'linear', url }` through `ProjectCommentView.externalLinks` and `ReviewCommentDto.links.external`. Labels are shipped metadata (“Linear”, “Open in Linear”), not external names. Public showcase/guest/private/suppressed/deleted/disconnected threads never expose the link. No Linear-specific toolbar DTO or component fork is added.

## 10. Infrastructure and configuration

Proposed configuration:

```text
LINEAR_CLIENT_ID             production OAuth application id
LINEAR_CLIENT_SECRET         production sensitive secret
LINEAR_TOKEN_KEY             protected 32-byte AES key, separate from other providers
LINEAR_API_BASE_URL          fixed production GraphQL origin; local/e2e override only
LINEAR_OAUTH_AUTHORIZE_URL   fixed production authorize URL; e2e override only
LINEAR_OAUTH_TOKEN_URL       fixed production token URL; e2e override only
```

Add production variables through `infra/src/index.ts` and CI's existing Pulumi reusable workflow; do not run `pulumi up` locally. Previews receive no production client secrets or grant key. Configuration checks require the full set; unconfigured cards/routes/workers cannot make provider calls. Use exact pinned dependencies if a client library is added; the initial plan needs only `fetch` and existing crypto.

The owner registers one OAuth application with the uier name/mark and existing brand contact/legal URLs. Enable app-actor consent and register only the exact production callback. Developers use a separate test application/organization and explicit localhost configuration; no customer grant is used by tests. Verify the portal's requested scopes and team restrictions before rollout.

## 11. Security and privacy

Threat boundaries: the OAuth requester is not trusted merely because they have a uier session; the selected organization/team/project is not trusted merely because its UUID exists; app-user access is not a substitute for current uier membership. Validate all three on save and delivery. Never recreate a removed uier membership to keep a grant working.

Keep OAuth state/PKCE and token secrets encrypted, provider-bound and server-only. Protect refreshes with leases/generations, enforce installation ownership, avoid credential logging, and test callback replay/cross-user/cross-workspace/provider mixups. Treat names, issue text, labels and source markers as data; do not execute them or interpolate them into GraphQL documents.

Before the first live connection ships, update privacy, terms, security copy and effective date for the exact phase: destination organization/team, text/quotes, display names, source/anchor/device context, status, selected mappings, replies and later screenshot bytes. Explain encrypted grant storage and per-thread issue/comment maps. Describe Linear as the destination the admin chooses under its own agreement; do not copy another provider's processor or retention wording without review.

Private threads are never exported. Later privacy/deletion changes trigger bounded cleanup of uier-owned content while connected. Provider history, recently deleted issues, notifications, exports and previously downloaded files can remain. Disconnect stops future sending and leaves external issues. A cleanup failure must be actionable, not presented as deletion success.

Screenshot upload is opt-in for the screenshot phase. Fetch bytes only through the authorized project screenshot service after current visibility/revision checks; never turn a protected URL into a public URL, embed a session cookie, or ask Linear to fetch uier's protected endpoint. Use only the signed storage destination/headers returned by the validated upload operation, do not forward GraphQL Bearer credentials to storage, and never persist/log signed upload URLs.

## 12. Testing

Add `apps/web/e2e/support/linearStub.ts`, with OAuth authorize/token/revoke and a small GraphQL state model. Validate operation names, scopes, app actor, variables, UUID reuse, destination identity, mutation success fields, cursor pagination and upload behavior. Fault injection includes HTTP-200 errors/partial data, 429, refresh replay, revoked grant, forbidden mutation, archived/moved issue, lost response after accepted create, mapping drift and incomplete cleanup. Tests use only their own fixture identifiers.

| Suite | Required evidence |
| --- | --- |
| `integrations.api.spec.ts` | Two adapters progress independently; partial fan-out replays; no early flag/tombstone acknowledgement; provider-specific backfill; generic links; disconnect preserves sibling provider |
| `linearOauth.api.spec.ts` | Single-use state, S256 binding, lost session, non-admin, organization ownership claim, scope mismatch, shared grant reuse, concurrent refresh, interrupted refresh grace and expiry, removed admin |
| `linearTransport.api.spec.ts` | HTTP-200 errors rejected, required success/entity validation, paginated selections, reset units, 429 pause shared by grant, timeout reconciliation and no sensitive logs |
| `linear.api.spec.ts` | Reserve/reuse issue and reply UUIDs; one object after accepted-but-lost response; edits/deletes; state mapping; private cleanup with no export; tombstone processed after source removal; destination switch isolation; backfill without Slack side effects |
| `linear.spec.ts` | Admin connection/destination flow, turn on/off/disconnect, commenter exclusion, safe RSC payload, light/dark axe, mobile and keyboard flows |
| Screenshot phase | Protected bytes/revision checks, one attached asset per revision after retries, no public URL bypass, expired upload recovery, truthful incomplete-cleanup state |

Local typecheck, build and relevant e2e must pass before implementation PRs. Stub success is not live acceptance. Record the actual production image/head, a dedicated test organization's grant/destination identity without secrets, create/edit/reply/status/cleanup readbacks, rate-limit recovery and a second-project shared-grant test. Test two authorizations before offering reconnect to customers.

## 13. Documentation changes

When implemented, add `docs/linear-integration.md` for operations, destination/state mappings, content ownership, idempotency, cleanup limits, refresh recovery and scheduler caveats. Reference the shared `docs/integrations.md` contract rather than duplicating its mutation rules.

Update README settings, document-type and configuration tables; `apps/web/AGENTS.md` layout/invariants/tests; `infra/AGENTS.md`; `.env.example`; legal/security pages; and toolbar docs for the generic external-link metadata. Keep plans and operations guides explicit about which phases actually ship. This plan alone does not require or authorize runtime/portal changes.

## 14. Phases

1. **Foundation and authorization.** Shared integration core first; crypto, OAuth/PKCE, installation claim, shared grant and destination validation. No sending on callback. Exit: scope/ownership/refresh tests and a real test-organization authorization/second-project trial pass.
2. **Issue mirror and privacy cleanup.** Create/update title, body and mapped state; generic app links; cleanup/recovery. Exit: real accepted-create ambiguity test or equivalent fault proxy, state readback, private/deleted cleanup, removed-admin stop and truthful retention copy. No release if cleanup requires unsupported permissions.
3. **Discussion and toolbar links.** Owned reply create/edit/delete with durable UUIDs; generic member-only toolbar links. Exit: no duplicate comment after lost response; human comments remain; guest/private links absent.
4. **Backfill and operations.** Connection-scoped newest-1000 backfill, retry tooling and grant-wide pause accounting. Exit: multi-run fixture plus two-provider acceptance with Slack unaffected.
5. **Screenshots.** Separate opt-in, byte upload, attachment projection and upload/retention guidance. Exit: access and recovery evidence plus matching legal/settings copy. No phase assumes a permanent file-erasure API.

Inbound changes, webhooks, agent interactions and manual issue handoff are separate product designs; they are not hidden extensions of these phases. GitHub and Slack need not wait for every Linear phase once the common core exists.

## 15. Risks and open questions

Release gates: actual app-actor cleanup permissions under the selected scopes; token behavior after a second authorization; safe recovery of installation claims; UUID create/reconciliation behavior; private-team and archived/moved-issue access; and upload retention. A failed gate changes the plan before launch, not after an external copy has been sent.

Proposed defaults requiring product confirmation during implementation:

1. Automatic one-way mirroring after explicit enablement; a manual “Send to Linear” mode is deferred.
2. One team and optional project per binding; multiple Linear destinations need a later binding UI.
3. App identity, shared grant within one uier workspace, no cross-workspace installation sharing.
4. Explicit open/done state mapping; assignment stays descriptive until the admin configures a verified identity map.
5. Manual removal/archive/move in Linear pauses the ledger; no automatic resurrection or reassignment.
6. Private/deleted source content is scrubbed and trashed while connected; no promise about historical/external copies.
7. Screenshots off until their independent phase and data-transfer copy are accepted.
8. Project done/comments disabled leave external issues alone; disconnect also leaves issues alone.

## 16. Decision log

- Reuse the shared integration layer; no Linear mutation hook, pending flag or toolbar DTO.
- Use a distinct app actor, without agent delegation/mention scopes or human impersonation.
- Treat a credential grant and a project destination binding as separate records; preserve other bindings on disconnect.
- Store UUID-v4 create ids before calls and reconcile them after uncertainty; never infer exactly-once delivery from HTTP success or a title search.
- Check GraphQL errors, success and selected entity fields even for HTTP 200.
- Keep Linear team/workflow IDs in mapping; do not create or guess customer workflow values.
- Never send private content or make protected evidence public; retain a durable cleanup intent when external removal fails.
- Model rate limits by shared app-user/grant, with independent provider progress and truthful scheduler/retention copy.
