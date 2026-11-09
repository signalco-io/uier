# Integration foundation

## Linked pull request state

`lib/comments/pullRequestLinks.ts` recognizes GitHub.com `/pull/<number>`, GitLab.com (nested groups
included) `/-/merge_requests/<number>`, and `dev.azure.com` / `<org>.visualstudio.com` PR links in current
messages and replies. It never infers a repository from a bare `#472`. Self-hosted/other URLs remain
ordinary message links and never trigger a fetch.

`lib/integrations/pullRequests.ts` is a read path independent of the mirror worker and its sync toggles.
The app-session-only `GET /api/projects/<project>/comments/<thread>/pull-requests` accepts only
project/thread ids, validates them, resolves current membership and reloads the visible saved thread.
It uses `no-store`, rejects cross-site browser requests and does not allow CORS or review-token access.
It runs outside the server action queue so a slow provider never delays a reply. It checks source access before external calls and again before
returning. The DTO has canonical URLs and optional states only, never provider titles, bodies or tokens.
The UI lists all recognized links and reads at most twenty states per view, three concurrently.

Private GitHub reads require this project's current binding to the exact repository, the connecting admin,
an active installation with repository access and unrevoked user authorization. A separate installation
token requests only Metadata read and Pull requests read; issue writer tokens retain their existing
permissions. GitHub installations without the optional permission fall back to public reads or a plain link.
Azure DevOps reads require the bound organization and project, the current connecting admin and a connected
grant with `vso.code` (or its stronger code scopes). Ordinary connections request only work-item/profile access and offline access.
The explicit **Show pull request state** reconnect in integration settings requests optional code read;
its scope choice is bound to the OAuth state and token exchange. Grants keep their original scopes on
refresh. Missing or denied code consent leaves PRs as plain links and work-item sync available.
Cached private state is checked against current connection/installation authority before returning it.
Preview deployments cannot use these provider credentials.

Public GitHub and GitLab reads send no authorization. URLs are constructed on `api.github.com`,
`gitlab.com/api/v4`, or `dev.azure.com` for authorized Azure reads; no message URL or provider redirect is
followed. Calls time out after five seconds and JSON reads are bounded to 512 KiB. The local-only public
API override accepts loopback hosts for `e2e/support/pullRequestsStub.ts`.

`pullRequestCache.ts` stores only hashed identities, state, expiry and leases, with a one-day TTL. Public
cache scopes are per provider; private scopes include workspace, project, connection and revision (and
Azure grant generation). A conditional 30-second lease deduplicates cold reads across instances; concurrent
views wait up to ten seconds for the existing read with bounded, spaced cache checks. State
expires after five minutes; unavailable state after ten. Durable hourly budgets allow 40 unauthenticated
GitHub reads, 120 GitLab reads and 120 reads per connected provider bucket. A 429 or GitHub rate-limit 403
pauses its shared bucket for at least fifteen minutes, honoring later provider retry/reset headers (up to
one day). A failed read stays a plain link. There is no scheduled polling or provider write.

`pull-requests.api.spec.ts` covers parsing, mapping, caching, budgets, private GitHub authority, visibility,
redirects and failures. `azure-devops.api.spec.ts` covers the connected-project scope and old-grant refresh.
`pull-requests.spec.ts` covers the app's details, list and board on desktop and mobile.

## Synchronization

`TwoWaySync` and its admin-only action save the independent, default-off `twoWaySync` connection
setting for GitHub, Linear, Azure DevOps and Notion. Notion requires a mapped Status/Select property.
`statusSync.ts` rotates a bounded accepted-ledger scan in the scheduled worker. Status-only delivery
shares the outbound lease and authority boundary; provider writes are prohibited. Recheck current
source/version, visibility, destination, toggle and admin before conditionally updating activity,
notifications and the source marker together. Pending uier edits win; polling never acknowledges
outbound progress or recreates external objects. Slack has no task-status sync.

`src/lib/integrations/` owns the shared outbox and delivery protocol described in
[`docs/integrations.md`](../../../docs/integrations.md). Every eligible non-public project mutation
records its source signal in the same write, including an unbound request snapshot; do not gate
that write on cached settings. Hard deletes use the conditional delete+tombstone batch. The
public showcase, private-only changes and no-ops remain excluded. Ordinary DTOs/reads never
contain signals or tombstones.

Discovery is bounded and cursor-paged by indexed `syncKey`. Acknowledge only after every target
is durable and source/binding checks still pass. Each provider gets independent leases, attempts,
budgets and progress. Preserve uncertain creates for reconciliation, and run cleanup with no
feedback packet. Every external call checks current membership, binding, source and destination.
Never persist feedback bodies in integration ledgers or expose credentials in views/logs.

The registry resolves all five adapters lazily to avoid initialization cycles with shared authority
helpers. Settings rendering is database-only; provider option/schema requests require an explicit
admin action. OAuth return routes bypass the signed-out proxy so transient codes and states are
never echoed into a sign-in return URL. Provider credentials are production-only, configured
through the setup runbook. Off/disconnect must work even when credentials are unavailable.

GitHub organization approval returns (`setup_action=request`, no installation id) consume bound
state, recheck admin access and select the original workspace before opening `settings/integrations?github=pending#github`.
Invalid GitHub setup/callback returns open `/app/github/error` in the app shell with recovery and
organization approval guidance. Never carry unverified project ids, callback codes or state into
that destination. `github.api.spec.ts` and `github.spec.ts` cover pending approval and recovery.

`replySync` is a separate default-off opt-in for all five providers. `replies.ts` bounds native
comment reads and owns marked-copy reconciliation; `importReplies.ts` projects source-labelled,
read-only imports. Server-only `integrationSource` identifies the external target and must never
appear in DTOs. Do not map provider identities to members, infer deletion from list absence, or
blindly resend uncertain creates. Commit incoming status/replies together after the source,
toggle, binding, destination and admin checks; keep verification-state semantics intact.
Slack history needs an explicit optional-scope reconnect; Notion needs read/insert comment
capabilities. Keep normal notification permissions minimal. Native-copy cleanup also runs when
reply sync is off. The React settings serialize booleans, never grants or source provenance.

The shared API suites are
`integrationSignals.api.spec.ts`, `integrationCredentials.api.spec.ts` and `integrations.api.spec.ts`.
Azure DevOps (`azure-devops/`) uses Microsoft Entra delegated OAuth with one grant per project
connection, so its work items are written as the connecting admin. It mirrors each thread into one work
item's text field rather than its Discussion, sets the mapped state only when the uier status changes,
and reconciles a lost create through WIQL and the copy's marker; see
[the Azure DevOps design](../../../docs/azure-devops-integration-plan.md). `azure-devops.api.spec.ts` and
`azure-devops.spec.ts` run against `e2e/support/azureDevOpsStub.ts`.
Provider tests and live acceptance are additional gates, not substitutes for shared isolation.
