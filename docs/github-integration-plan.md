# GitHub integration: implementation plan

Status: plan, not shipped. Provider facts checked against official GitHub documentation on 2026-10-28; repository entry points checked on the same date. Product defaults below are design decisions, not existing behavior. All implementation paths are proposed unless described as existing.

Build on the [shared integration architecture](notion-integration-plan.md#21-expansion-to-other-services). The [Linear plan](linear-integration-plan.md) and [Slack notifications plan](slack-integration-plan.md) are independent adapters on that foundation.

## 1. Goal and scope

A workspace admin connects a uier project to one GitHub repository through the uier GitHub App. After the admin chooses the repository and turns sending on, each eligible thread becomes one issue. The scheduled worker keeps uier-owned issue content and status converged with the current thread. uier remains the source of truth.

Default: continuous one-way mirroring of all supported feedback kinds, new changes only. Connecting never silently backfills old threads. Private threads and the public showcase project are excluded without an override. A separate bounded backfill is explicit. Comments on GitHub are written by the app bot, with the reviewer's display name in the copied text; they do not impersonate the reviewer.

Ships in phases: installation and user-authorized destination binding; current issue title/body and open/closed status; discussion mirroring; member-only external links; bounded backfill and operator recovery.

Non-goals: pull requests, source-code access, GitHub Projects, issue dependencies/types/custom fields, automatic GitHub user assignment, creating labels, private feedback export, two-way sync, executing feedback as instructions, automatic installation deletion, public screenshot uploads and any external call from a comment mutation request. Manual issue handoff is a later product mode, not a hidden fallback when automatic mirroring fails.

## 2. How it works

The shared mutation signal increments `syncVersion` once. `discoverIntegrationSync` fans out to each bound connection before clearing `syncPending`. A `github-sync` ledger is independent of Notion, Linear, Slack and email. A GitHub adapter leases no source flags and acknowledges no other provider's work.

The shared delivery runner checks the current binding, enabled state, connecting admin's membership and private visibility before each attempt. It loads `projectFeedbackExport` as `memberActor(project, connectedBy)`, gives the adapter the authorized `FeedbackContext`, persists the operation plan, then sends through a repository-scoped installation token. Cleanup follows a separate path without exporting private or deleted text.

```text
uier mutation -> shared pending signal -> durable ledger per connection
                                         |
github-sync -> authorize -> current export -> persisted plan -> GitHub API
                                         |
                                 issue/comment ids + hashes
                                         |
                         generic externalLinks[] for members
```

Existing web entry points, relative to `apps/web/`: `src/lib/review/feedbackContext.ts`, `src/lib/app/model.ts`, `src/lib/app/projects.ts`, `src/components/app/projects/actions.ts` and `scripts/notifications-worker.ts`; the existing workflow is `.github/workflows/notifications.yml` at the repository root. The shared registry/worker described in the Notion plan must ship before this adapter is enabled. It does not exist merely because this document names it.

## 3. GitHub facts the design depends on

- GitHub App setup and OAuth callbacks serve different purposes. A setup redirect's `installation_id` can be forged; GitHub directs apps to verify it using a user access token. Installation URLs can carry `state`. [Setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url), [sharing an app](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app).
- GitHub App user tokens intersect app and user access. The web flow supports PKCE with `S256`; user tokens can list accessible installations and their repositories. Repository results include the user's permissions. [User authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [installation endpoints](https://docs.github.com/en/rest/apps/installations).
- An app JWT obtains installation tokens; tokens can be restricted to repository ids and permissions and expire after one hour. Do not validate tokens by fixed length or prefix. [Installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [JWT generation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app).
- Issue create/update operations accept installation tokens with Issues write permission. Issues can be closed/reopened. Lists also include pull requests; `pull_request` distinguishes them. Issue creation triggers GitHub notifications. This plan makes no silent-write promise. [Issues endpoints](https://docs.github.com/en/rest/issues/issues).
- Issue comments have list/create/update/delete operations available to installation tokens with the relevant Issues permission. [Comment endpoints](https://docs.github.com/en/rest/issues/comments).
- Rate limiting can return 403 or 429. Honor `Retry-After`, then primary reset headers; otherwise wait at least a minute and back off. Secondary limits also constrain content creation. [Troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- Pin `X-GitHub-Api-Version: 2026-03-10`, a currently supported version, rather than relying on the default. [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions).

The API contracts above do not promise exactly-once creation or removal of historical copies. Reconciliation and privacy behavior below are uier policy; hosted tests are required before launch.

## 4. Data model

Reuse the common connection/sync envelopes. No new comment cursor, pending flag or feedback packet is added. One repository per GitHub binding in the first release.

| Record | Partition and identity | Provider fields |
| --- | --- | --- |
| `github-installation` | `github-installation:<installationId>`, `installation` | app id, account id/type, bounded account label, installation status, permission snapshot, `checkedAt`, rate-limit pause; shared installation authority, no copied feedback |
| `github-connection` | `workspace:<workspaceId>`, `github_<projectId>` | common connection fields; installation id, repository numeric id/node id, current owner/name, visibility, selected existing labels, destination revision, `since`, optional backfill cursor |
| `github-oauth-state` | `user:<userId>`, hash of provider/user/workspace/project/stage | state hash, stage, candidate installation id, encrypted PKCE verifier when needed, expiry; 600-second TTL, single use |
| `github-setup` | `user:<userId>`, random setup receipt | encrypted user token retained locally for at most 600 seconds, optional provider-token expiry, verified GitHub user id/login and installation id, allowed repository selection; 600-second TTL, consumed on save |
| `github-sync` | `github:<projectId>`, `github_<sha256(connectionId + ':' + projectId + ':' + threadId)>` | common sync fields; active destination record and `retiredDestinations[]`, each retaining destination revision, installation/repository identity, issue id/number/url, owned body hash/markers, discussion item map, uncertain attempts, per-destination processed version, reconciliation cursor and cleanup progress |
| `github-event` | `github-events:<appId>`, delivery id | allowlisted lifecycle event type and installation/repository/user ids, received time, processed flag; bounded retention, no issue text |

`DbProject.integrations.github = { connectionId, since }` is installed only after a repository is verified and the admin explicitly enables it. Project updates merge only this provider's entry under etag. Turning off retains the binding and queues pending state; disconnect removes it and suppresses only its ledgers and links.

The installation record may be shared by bindings in different uier projects or workspaces. It is not a grant to read those bindings. Every lookup checks the binding's own workspace/project membership. Losing installation access pauses all referencing bindings; disconnecting one project never deletes the GitHub installation or breaks another project.

Installation tokens are minted on demand and held only in run memory. The app private key and client secret live in deployment secrets, never connection documents. Only the temporary setup receipt stores a user token, encrypted with AES-256-GCM, random IV, key id and AAD bound to `github`, user, workspace, project, receipt and field. Wipe the receipt on save, denial, expiry or membership loss. Its 600-second local retention limit does not cause the GitHub credential to expire or revoke it. Record provider expiry when returned, and reject a token once either its provider expiry or the local receipt expiry is reached. TTL is a fallback, not the primary cleanup path.

GitHub App user-token expiration is configurable; an exchange from a nonexpiring configuration may omit expiry, while expiring configurations can return refresh credentials. Validate the response against the app's selected configuration, persist only the access token and applicable expiry in the temporary receipt, and discard unused refresh credentials immediately without logging or storing them. Do not use provider refresh to extend the setup receipt. This plan does not claim provider-side token revocation on receipt deletion; any later revocation operation needs its own verified endpoint and shared-authorization impact assessment. [User-token configuration and exchange](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Persist no raw export or issue body in the ledger: hashes, ids and bounded operation metadata only. `attempt` retains an operation id, source version, destination revision, operation kind, first-send time, marker and reconciliation progress. Rebuild text from fresh authorized source state before each write; an uncertain earlier create must be reconciled before a new projection can create anything else.

## 5. Connect and disconnect

Proposed routes under `apps/web/app/(rest)/(app)/app/github/`: `connect`, `setup`, `callback`. Declare them in `knownPages.ts`. Use trusted `appBaseUrl()` for redirects, no-store responses and plain anchors with `Button asChild` so prefetch never creates authorization state.

1. `connect?project=<id>` requires a verified uier session, current admin membership, project ownership and a configured provider. Reject `PUBLIC_PROJECT_ID`. Check same-origin fetch metadata as in the Notion design. Create a random install state whose hash is bound to provider/user/workspace/project and redirect to the fixed app installation URL.
2. `setup` treats `installation_id` and `setup_action` as untrusted hints. Atomically consume the install state; a foreign user, expired state or replay fails. Store the candidate id and mint a different OAuth state plus a PKCE verifier. Redirect to GitHub user authorization with the exact registered callback, `state`, `code_challenge` and `S256`.
3. `callback` atomically consumes the OAuth state, rechecks uier admin membership and project ownership, exchanges the code server-side with its verifier, and uses the resulting user token to list accessible installations and repositories. The candidate must be present and belong to this registered app. Denial or mismatch writes no binding.
4. A locally short-lived encrypted setup receipt backs the server-side repository picker. Require the repository's returned `permissions.admin === true` by product policy; do not infer destination ownership from an installation id or a typed owner/name. The save action revalidates the selection through the user token and checks installation repository access and Issues write permission. An expired receipt or provider token restarts setup; no refresh credential is retained, and receipt expiry does not imply provider-token revocation.
5. Show owner/name and public/private visibility, and a clear disclosure of what will be copied. Only “Connect repository” saves the connection and pointer. Installation by itself never starts sending feedback. Reconnecting an existing installation may use the authorization flow without repeating installation, but must perform the same verification.

Organization installation approval can be pending. Display that state and send nothing; never manufacture a successful connection from an install request. Exact permission payloads for personal, organization and SSO installations are a hosted phase-1 gate.

Before every external attempt the runner rebuilds uier membership; removal/demotion suppresses the binding and requires another admin to reconnect. Installation access is organization/application authority, not the discarded setup token's continuing lifetime. Recheck installation status and destination access through the worker, and consume lifecycle webhooks below. The settings copy must explain this distinction.

Disconnect removes only `integrations.github`, deletes that project's connection and any setup receipts, and keeps suppressed ledgers for reconciliation if the same destination reconnects. It calls no installation deletion endpoint. Existing GitHub content stays there; cleanup must be requested while access still exists if the admin wants it. Link to the app's GitHub installation settings for broader removal.

## 6. Repository selection and field mapping

Repository lists are loaded in authenticated server actions, paginated and bounded to 500 choices per picker session. An incomplete list says so. Persist repository ids as authority; names are display/path metadata that can change. Before writes resolve the current repository under the installation and reject id mismatches, archived/disabled destinations or disabled Issues. Never follow an arbitrary API redirect with credentials.

Public repositories are supported only after an explicit disclosure that the mirrored text becomes public. Default selection is empty. The picker does not silently choose the first repository, including when only one is visible.

| uier field | GitHub projection |
| --- | --- |
| Title | `context.title`, bounded; preserve rewrite labeling |
| Feedback, quoted original text, anchor and reproduction | Clearly labeled sections in the owned issue body, generated only from `FeedbackContext` |
| Source/review links | Approved token-free packet URLs; unavailable sources remain unavailable |
| Status | Open maps to open; done maps to closed/completed; reopen maps to open |
| Kind/environment | Body metadata; optional admin-selected existing labels in a later phase |
| Assignee | Display name in the body; no identity matching or GitHub assignment |
| Discussion | One bot-owned issue comment per saved discussion item in phase 2 |
| Screenshot | An access-checked “View screenshot in uier” link, with a sign-in warning; no image bytes, bearer token or public bypass |

`integrations/github/issue.ts` is a pure formatter. Feedback and selectors are literal text in dynamically sized fences. Escape untrusted display names and labels; neutralize user-authored mentions in any text rendered outside literal fences to avoid accidental GitHub notifications or HTML interpretation. Rendering and mention behavior require a hosted fixture. The issue states that reviewer content is untrusted and changes are managed from uier.

Use an opaque deterministic ownership marker, for example an HTML comment containing a keyed hash of provider/connection/project/thread, appended outside user content. Per-item comments use a separate marker bound to the item id. Markers contain no secrets or raw feedback, and are integrity/ownership hints rather than authorization. Adoption additionally requires the expected app bot author, repository id and ledger scope.

Select conservative title/body/comment payload limits below GitHub's live limits and test their exact accepted values before launch. If a packet is too large, send an explicit bounded summary with a uier link and record `content_truncated`; never claim a complete mirror. No undocumented upload endpoint or issue artifact API is needed for screenshots.

## 7. Sync semantics

The adapter converges current state. It does not replay every mutation or equate GitHub issue closure with uier read state.

| uier change | Planned GitHub operation |
| --- | --- |
| New eligible thread | Create one bot-owned issue and store its ids and URL |
| Feedback, anchor, source, environment or assignee edit | Replace the owned issue body/title only when projected hashes differ |
| Done/reopen | Update issue state to the current uier state |
| Reply | Create one bot-owned issue comment for its stable item id |
| Reply edit/deletion | Update that owned comment to current text or a deleted placeholder |
| Private transition or hard deletion | Redact owned title/body, remove owned discussion comments where possible, close the issue, hide the uier external link |
| Visible again | Rebuild the same retained issue only when ownership/destination checks still pass; no private text is exported during cleanup |
| Destination repository changed | Freeze/reconcile the old revision, preserve its complete external/attempt map as retired, then project future changes/backfill under a fresh destination revision; disclose old copies |

Do not overwrite comments from GitHub users. The app owns the full body of the issue it creates, which the card and issue notice explain. A missing/altered marker, changed author or destination conflict stops as `ambiguous` instead of overwriting or adopting arbitrary content. Changing GitHub content never mutates uier; deliberate external edits may be replaced by the next uier projection.

Repository switches keep the connection id and ledger key; they must not overwrite the old issue/comment map. Under the ledger lease, freeze the old destination before any new-revision write and retain a retired record containing its installation id, repository id/node id and last verified path, issue/comment ids, ownership markers/hashes, unresolved attempts, processed version and cleanup cursor. Reconcile every unresolved old write or leave that ledger stopped for review; an old attempt never runs against the new destination. Once that boundary is resolved, initialize a fresh active destination projection. Its processed cursor cannot inherit success from the old repository, even when the source version has not changed.

Retired records retain the original verified binding authority for cleanup, not permission to publish more feedback. Each cleanup attempt rechecks the current uier admin/binding plus access through that retired record's original installation and repository-scoped token. Do not use the new destination's installation or path for an old target, and report blocked cleanup when the old grant is unavailable. Privacy transitions and deletion traverse the active record and every retired record, including reconciliation of uncertain old creates. Retain their ids and cleanup results while copies or unresolved attempts remain; a repository switch cannot make them undiscoverable. External links expose only the active verified destination.

Persist each create attempt before the call. A success stores the external id; a timeout or connection loss after send retains the attempt. Reconcile uncertain issue creation by listing repository issues with `state=all`, excluding pull requests and comparing exact marker, bot author and repository id. Scan the relevant creation window with pagination, persist progress under the lease and respect budgets. A partial/empty bounded scan is not proof that creation failed.

For uncertain discussion creation, list that issue's comments and match the item marker and author. One exact match is adopted; several matches are `ambiguous`. Read-after-write delays and an empty completed scan remain uncertain: retry reconciliation with backoff, then require operator review after the failure bound. Do not automatically resend an uncertain POST on the strength of search results. The operator may explicitly confirm absence and authorize a new create; record that recovery. This gives durable duplicate prevention without claiming an API idempotency guarantee.

Cleanup uses the common deletion intent and stored external ids after shared discovery has removed the tombstone. If an issue/comment create was still uncertain when the source became private or was deleted, reconcile that attempt first without ever issuing another create; a missing stored id does not prove that no copy exists. Verify ownership before each destructive external operation. Retry partial cleanup from its persisted cursor. If access is gone, hide the link and report `cleanup_blocked`; do not label cleanup accepted. Redaction and closure are not permanent erasure: GitHub histories, notifications, copied content and independently authored replies can remain.

Backfill is explicit, newest 1000 visible threads at most, private threads excluded. Enqueue only this GitHub connection through the shared helper; preserve newer requested versions and never trigger Slack notifications or Notion backfill. Queue at most 50 threads per run initially. Destination switches do not migrate or delete old issues automatically.

## 8. Delivery worker

Proposed adapter modules: `apps/web/src/lib/integrations/github/{config,client,auth,connection,issue,delivery,view}.ts`. Register capabilities for one-way issues, status, optional discussion and protected screenshot links; attachment upload and inbound feedback writes remain false.

The shared runner owns leases, attempts and retry counters. The adapter supplies bounded operations and classifies GitHub errors. Use plain server `fetch`, explicit GitHub API/authorize hosts, fixed version/accept headers and 20-second timeouts. Installation token minting is serialized per installation in-run, refreshed before expiry, and scoped to the binding's repository and Issues permission. A 401 permits one fresh mint and repeat of a safe/reconciled operation, not blind resending of a create.

Persist rate-limit pauses per installation, with an app-wide content-write bucket so different installations cannot bypass conservative provider pacing. Initial uier budgets: sequential calls, at least one second between content writes, at most 60 total calls and 20 content writes per installation per run, plus the shared fair wall-clock allowance. These are uier ceilings, not GitHub quotas; lower them dynamically from response headers and secondary limits.

| Result | Ledger/connection action |
| --- | --- |
| 403/429 identified as rate limit | Waiting; persist the applicable pause, no ordinary failure increment |
| Installation deleted/suspended, missing Issues permission or repository removed | Pause all affected bindings; no calls until repaired/reconnected |
| 404/410 on destination or recorded issue | Revalidate installation/repository separately; preserve the issue reference and require review before recreation |
| 422 validation | Bounded code; invalid mapping pauses, unsupported/oversized content fails visibly |
| 5xx/network before send | Exponential backoff within the shared failure bound |
| Uncertain create response | Keep attempt; reconcile first as section 7 specifies |
| Private/deleted source | Cleanup path only; no feedback export |
| Disabled/disconnected binding | Wait or suppress only this connection; do not consume another provider's progress |

Errors retain only HTTP status, bounded classification, retry headers and GitHub request id. Never store response bodies, authorization headers or feedback text in logs. Operator retry requires `{ provider: 'github', ledgerId }`; it cannot reset another provider or discard an uncertain create attempt.

Lifecycle receiver at `/api/integrations/github/webhook` verifies the raw request's HMAC-SHA256 signature with constant-time comparison, then deduplicates `X-GitHub-Delivery` and stores only installation/repository/actor ids needed for access lifecycle handling. [Signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [delivery headers and events](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

Handle installation deletion/suspension and repository-selection changes as access signals; re-read current installation state before resuming. User-authorization revocation invalidates any outstanding setup receipts for that GitHub identity; it does not imply that an independent organization installation was uninstalled. Delayed/out-of-order events cannot resurrect a disconnected binding. This receiver never copies GitHub comments or state into uier. A duplicate acknowledged delivery is harmless. Worker API checks remain necessary because webhook receipt is not guaranteed evidence of current access.

## 9. App UI

Add `components/app/github/GitHubSection.tsx` within the admin-only Integrations group. Use the existing shadcn controls, semantic tokens and brand sentence case. Only an allowlisted `GitHubConnectionView` reaches the browser: status/code, repository display label and visibility, enabled state, backfill progress, last accepted time and needs-review count. No private key, tokens, setup receipt contents or internal grant document.

Core copy:

- “Send this project's comments to GitHub issues. Private comments are not sent.”
- “Choose a repository. Sending starts after you connect it.”
- Public destination: “This repository is public. Anyone can read the feedback copied to it.”
- On: “New comments and status changes are sent within a few minutes.” Phase 2 adds replies.
- Off: “Sending is turned off. Changes wait until you turn it on.”
- Access lost: “uier cannot access this repository. Check the GitHub installation or reconnect.”
- Cleanup blocked: “uier could not remove copied content from GitHub. Review the issue in GitHub.”
- Disconnect: “uier stops sending comments. Existing issues stay in GitHub. Other connected projects keep their access.”

Member app/toolbar views consume the generic `externalLinks[]` entry `{ provider: 'github', url }`, labeled “GitHub” / “Open in GitHub”. Validate HTTPS `github.com` issue URLs against the verified repository and issue identity; no arbitrary redirect or provider URL. Suppressed, cleanup-pending, private, deleted and disconnected threads expose no link. Guests and the public showcase receive none. A link does not grant repository access.

## 10. Infrastructure and configuration

| Variable | Proposed handling |
| --- | --- |
| `UIER_GITHUB_APP_ID`, `UIER_GITHUB_APP_SLUG`, `UIER_GITHUB_CLIENT_ID` | Production configuration; separate names from CI's `GITHUB_TOKEN` |
| `UIER_GITHUB_PRIVATE_KEY` | Sensitive PEM app key, deployment secret; server/worker only |
| `UIER_GITHUB_CLIENT_SECRET` | Sensitive OAuth exchange secret |
| `UIER_GITHUB_SETUP_KEY` | Protected 32-byte key for short-lived encrypted setup credentials |
| `UIER_GITHUB_WEBHOOK_SECRET` | Sensitive high-entropy signature secret |
| `UIER_GITHUB_API_BASE_URL`, `UIER_GITHUB_OAUTH_BASE_URL` | Fixed production defaults; local/e2e stub overrides only |

The provider is unavailable unless all required configuration is present. Previews get no production GitHub credentials or registered preview callbacks. Development uses a separate test app and a fixed localhost callback supported by that app's verified registration. CI applies infrastructure; no local `pulumi up`.

Register a public GitHub App once with Metadata read and Issues read/write, no Contents, Actions, Pull requests, organization-member or account-email permission. Use selected repositories in the customer installation flow. Register exact production setup/callback/webhook URLs, uier branding and existing support/legal links. Subscribe only to lifecycle events required by section 8. Test organization approval, SSO, uninstall and repository removal before allowing customer connects.

Protect the shared signing key and setup encryption key in Pulumi. Pass secrets through existing reusable deployment workflows explicitly. Add presence-only configuration diagnostics to the worker; no values, key fragments or user-token exchange payloads. Key rotation keeps an overlap/rollback procedure and validates new minting before retiring the old key.

## 11. Security and privacy

Never send `comment.private || isPrivateAppFeedback(comment)`, even when the connecting admin could read it. Shared export permissions and the actor-independent private exclusion both apply. Revalidate membership and the binding at the external-call boundary; acknowledge that already in-flight calls cannot be recalled.

The installation callback is not authorization. Single-use stage-bound states, PKCE, verified GitHub user access, explicit repository selection and server-side id checks prevent cross-account binding. No client-supplied hostname, repository path or installation id is trusted as authority. Names, feedback, selectors and webhook fields remain untrusted content.

The public-repository confirmation and privacy copy must precede enablement. State exactly which text, display names, source/device context, status and links are copied; discussion is added only when phase 2 ships. Screenshot bytes remain in uier. An outside reader needs separate uier access for protected images.

Before launch update privacy policy, terms and security guidance for GitHub as an admin-selected recipient under the admin's own agreement. Document that issue redaction/closure and comment removal cannot recall notifications, history, backups or copies, and that losing installation access can block cleanup. Have the owner review transfer/retention wording against applicable GitHub terms; do not inherit Notion's company/legal details. Disconnect does not uninstall the shared app.

Credentials never appear in client payloads, action results, logs or errors. Diagnostics also exclude feedback bodies and private repository names; structured logs carry provider, ledger id and bounded code. Repository display labels are allowed only in current authorized connection views and picker responses, as section 9 specifies. Check that allowlist in HTML/RSC and action responses. No browser-to-GitHub API fetch or CSP expansion is required; authorization uses top-level redirects.

## 12. Testing

Add `apps/web/e2e/support/githubStub.ts`, a local stateful HTTP stub with OAuth/PKCE, user/installation identity, repository permissions, installation token minting/expiry, issues/comments and signed lifecycle events. The e2e API/OAuth base URLs target only the stub. It records expected calls without exposing credentials outside dedicated assertions.

| Suite | Acceptance cases |
| --- | --- |
| Shared `integrations.api.spec.ts` | GitHub plus a second adapter; partial fan-out replay; independent retry/pause/disconnect; provider-scoped backfill; deletion intent after tombstone removal; generic multi-link DTO |
| `githubAuth.api.spec.ts` | Forged installation id; mismatched app/user/project/provider; replay at each stage; PKCE mismatch; expired setup receipt and independently expired provider token; configured nonexpiring response without expiry; expiring response validation; unused refresh credentials never persisted; denied/pending install; missing repository admin permission; no binding before explicit save; removed admin; shared installation isolation; tokens absent from client output |
| `githubTransport.api.spec.ts` | Fixed version/hosts; narrowed token permissions/repository; expiry and one remint; encoded paths; primary/secondary rate headers; 403 distinguished from permission denial; no response-body logging; mention neutralization and literal feedback fences |
| `github.api.spec.ts` | One issue per ledger/destination revision; current title/body/status; discussion create/edit/delete placeholders; uncertain issue/comment create adopted after restart; empty/partial reconciliation never blindly resends; duplicate markers stop; external human comments untouched; private/deletion cleanup resumes; access loss is not interpreted as issue absence; switch with uncertain old issue/comment create freezes the new revision; retired ids/markers/attempts survive restart; old attempt never reaches new repository; same source version projects anew in the new destination; later privacy/deletion cleans active and retired targets through their original authority; unavailable retired grant reports blocked cleanup; old copies disclosed |
| `githubWebhook.api.spec.ts` | Correct/invalid raw signature; duplicate delivery; bounded allowlist; wrong app; out-of-order suspend/resume; repository removal; no inbound feedback write; disconnected binding never revived |
| `github.spec.ts` | Admin picker and public warning; commenter/guest hidden region; persistent on/off/reconnect; multiple provider cards; member-only links; keyboard/mobile and axe in both themes |

Launch evidence additionally requires a disposable hosted personal repository and organization repository: install/approval, selected-repository grant, second project using the same installation, lost repository access, app suspension/uninstall, 401 recovery, title/body/status, discussion cleanup, screenshot access restrictions and create-response loss. Record exact app permissions, commit, issue URLs and observed worker runs; local stub success alone does not prove GitHub compatibility.

Before each implementation PR run the repository-required typecheck, build and e2e suite. This planning document ships no runtime integration and changes no customer GitHub resources.

## 13. Documentation changes

- `docs/github-integration.md` on implementation: supported behavior, installation authority, public destinations, ownership markers, reconciliation/operator recovery, cleanup limits and batching-window caveat.
- `docs/integrations.md` and README: registry/capability entry, shared grant behavior, new document types, configuration and worker retry examples.
- `apps/web/AGENTS.md`: adapter, route and webhook layout; access rules and stub scenarios.
- `infra/AGENTS.md` and `.env.example`: server-only credentials, protected resources and preview isolation.
- `docs/feedback-context.md` and toolbar guides: generic external link entry and protected screenshot behavior, while keeping Copy issue's manual-export contract accurate.
- Privacy policy, terms, security page and `SECURITY.md`: match the data sent by the shipped phase and explain retained external copies.

## 14. Phases

Phase 1: verified connection and first issues. Shared foundation, signing/secrets, install/OAuth/setup receipt, destination picker, worker adapter, owned issue body/status, deletion/privacy cleanup, lifecycle access signals and member app link. Exit: shared and GitHub auth/transport/delivery tests pass; hosted personal/organization authorization proves that a forged installation cannot bind; two projects share one installation without cross-project leakage; legal/configuration docs match; first issue appears from an actual scheduled run.

Phase 2: discussion and toolbar link. Add the item map, comment update/removal, reconciliation tests and generic toolbar entry. Exit: a 50-item thread stays within budgets across runs; failed create responses do not duplicate comments; human replies stay unchanged; private cleanup removes all owned current content and reports its limits.

Phase 3: bounded backfill and operations. Add progress, operator retry/ambiguity resolution and destination-switch confirmation. Exit: backfill with existing ledger ids creates no duplicates, does not queue another provider, survives restart and honors primary/secondary pauses; uninstall blocks delivery without repeatedly minting tokens.

Later design only: manual issue handoff, explicit GitHub assignee mapping, screenshot attachment upload, GitHub Enterprise hosts or inbound state/comments. Each requires its own verified capabilities, permissions and privacy plan. Lifecycle webhooks in phase 1 do not authorize these features.

## 15. Risks and open questions

1. Continuous issue mirroring is the default in this plan. Confirm whether some workspaces instead need manual per-thread handoff before implementing another mode.
2. Repository admin permission is required to bind by default. Confirm organization/custom-role fixtures and whether a lower role should ever be supported.
3. Uncertain creates may stop for operator review instead of automatic resend. This trades delayed delivery for avoiding duplicates; do not weaken the rule without verified API support.
4. Public destination copy is explicit. Decide whether launch should additionally restrict connections to private repositories; never infer that private uier threads may be sent to either.
5. Screenshot bytes are deferred. Keep the protected link until a documented upload path, access model and retention behavior are verified.
6. External issue transfer/deletion, body-marker removal and access loss require review by default, with no automatic issue recreation.
7. Default discussion mapping writes each saved reply as the app bot. Confirm expected GitHub notification volume during the hosted phase-2 fixture.
8. App installation authority persists independently of the setup user token. uier admin removal stops its bindings; product copy and organization policy must accept this model.
9. GitHub content can outlive redaction and loss of access can prevent cleanup. Do not promise erasure or equate closed issues with removed data.
10. Rate limits and lifecycle webhooks span many projects. Shared installation/app pauses, bounded turns and credential-safe recovery are launch requirements, not optimizations.

## 16. Decision log

- GitHub App installation tokens with selected repositories; no customer-pasted PAT and no source-code permission.
- Separate verified GitHub user authorization during setup; a redirect installation id alone cannot establish a binding.
- Per-project repository binding, shared installation authority, independent workspace access checks.
- Continuous one-way issues as the initial mode; uier owns mirrored content and status, while GitHub user replies stay external.
- Shared mutation/discovery/delivery primitives and generic external links; no GitHub-specific comment fields.
- Persist-before-send and marker/author/destination reconciliation; uncertain POSTs are never blindly retried.
- Redact/close owned issues and clean owned discussion on privacy/deletion; acknowledge retained copies and blocked cleanup.
- Protected screenshot links only; attachment upload, manual handoff and inbound sync remain separate designs.
