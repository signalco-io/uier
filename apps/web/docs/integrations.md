# Integration foundation

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
