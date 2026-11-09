# Connected services

## Implementation status

The shared synchronization foundation, five adapters, OAuth routes and admin-only project settings
are implemented. A project's Settings → Integrations shows the services to connect as a grid and the
connected ones below it; each service's destination and controls are on its own page
(`settings/integrations/<provider>`), where OAuth returns. Each provider stays unavailable until its
deployment configuration is valid:

| Provider | Contract | Status |
| --- | --- | --- |
| [Notion](notion-integration-plan.md) | One page per thread, kept current | Implemented; registration and hosted acceptance required |
| [GitHub](github-integration-plan.md) | Issue mirror with optional two-way status | Implemented; GitHub App registration and hosted acceptance required |
| [Linear](linear-integration-plan.md) | Issue mirror with optional two-way status | Implemented; app registration and hosted acceptance required |
| [Slack](slack-integration-plan.md) | Bounded channel notifications | Implemented; rotating bot credentials, distribution approval and hosted acceptance required |
| [Azure DevOps](azure-devops-integration-plan.md) | Work item mirror with optional two-way status | Implemented; Microsoft Entra app registration and hosted acceptance required |

Each provider's features and configurable settings live in `apps/web/src/lib/integrations/catalog.ts`.
The public guide (`/integrations/<provider>`) and the project's page for the provider in the app
(**What it does**, with On or Off for two-way status sync and reply sync) render the same list, and the
API suite checks that its sync features match each adapter's `supportsStatusSync` and
`supportsReplySync`. Change the catalog with the adapter. Suggestions for new integrations arrive as
toolbar feedback: public on `/integrations` (the showcase project), private to the person and the uier
team from the app's Integrations settings.

An admin must connect a provider and explicitly save its destination before delivery starts.
Connections are independent: a project can use all five services. The provider's own permissions
control access to its copies. See [setup and manual tasks](integration-setup.md) and
[delivery operations](integration-operations.md). No live provider acceptance is implied by a local test.

## Provider behavior

- **Notion:** a selected data source receives one page per shared thread, mapped by stable property
  ids. Title and uier id are required. Optional status, environment, kind, links, date and assignee
  mappings are validated against the live schema. The page includes feedback, discussion,
  reproduction context and the saved screenshot when upload succeeds. Privacy cleanup empties
  known pages before trashing them; status metadata, Notion history and retained files can remain accessible.
- **GitHub:** a GitHub App installation and separate PKCE user authorization verify installation
  access and repository administration before the repository is saved. Public repositories require
  explicit confirmation. Issues mirror current feedback and status; bot-owned discussion comments
  mirror replies. Protected screenshot links lead back to uier. Human GitHub comments are kept.
  Signed lifecycle webhooks update installation authority without importing GitHub issue changes.
  A repository becoming public requires renewed public-destination confirmation before more
  content is sent. That consent pause still allows enabled, authorized privacy cleanup of known copies.
- **Linear:** app-actor OAuth uses an organization grant shared by this uier workspace's projects.
  Admins choose a team, optional project, open/done states and existing labels. Persisted UUIDs
  reconcile uncertain issue/comment creates. Optional screenshot uploads create Linear-owned
  copies. Human labels and discussion remain separate from uier's managed content.
- **Slack:** a rotating bot grant posts one root message for new shared feedback in the chosen
  channel and updates its current summary. Optional reply-count and status summaries are off by
  default. The normal connection requests no history, direct-message or file scope. Optional reply sync requests public/private channel history through an explicit reconnect. The app must already be a channel
  member. Channel changes start a new activation cutoff; edits to older threads stay silent unless
  an admin explicitly selects backfill or resumes a cleaned thread. Missing bot messages are held
  for review. An uncertain post cannot be found automatically without history access, so an admin
  must adopt its known timestamp or explicitly attest absence before another post is allowed.
  Fresh channel metadata is checked before content writes; a channel becoming shared or otherwise
  ineligible stops those writes while known-copy cleanup remains possible.
- **Azure DevOps:** Microsoft Entra ID OAuth with delegated `vso.work_write` and `vso.profile`
  scopes (plus `vso.code` read only after an explicit **Show pull request state** reconnect, for linked PR
  state), so work items are written as the
  connecting admin's work or school account. Each project
  connection has its own grant. Admins choose an organization, project, work item type, open and done
  states from the type's state categories, and an optional area path. One work item per thread holds
  the feedback, context and uier discussion as escaped HTML in Description (Repro Steps for bugs).
  The mapped state changes only when the uier status changes, so board moves are kept. A lost create
  is reconciled through a WIQL query and a marker in the text. Privacy cleanup replaces the text and
  deletes the work item to the project's recycle bin; work item history keeps earlier revisions.

Each adapter retains ids and original destination authority for old copies. Changing a destination
does not promise their removal. Unavailable old authority produces a visible cleanup failure rather
than an erasure claim. Disconnect stops future work and retains reconciliation metadata. Removing
the app or external copies in the provider is a separate action.

Settings rendering only reads uier's database. Provider pickers and schema reads run on an explicit
admin action. Off and disconnect remain available when deployment credentials are unavailable.
Backfill selects at most the latest 1,000 threads (Slack: 100), excludes private feedback and persists
a durable selection. Queueing progress counts local delivery requests, not completed external sends.
The worker queues bounded batches; a changed destination cancels an old selection. Forced backfill
is separate from ordinary source intent and never replays an old selection into a new destination.

## Two-way status sync

GitHub, Linear, Azure DevOps and Notion each have an independent **Enable two-way status sync**
option on their integration settings page. It is off by default, including for existing connections.
Saving it off stops provider-to-uier status updates; ordinary uier-to-provider copying continues.
Turning the integration itself off or disconnecting stops both directions. Slack remains a notification
integration and has no task-status toggle.

- GitHub closed issues become Done; reopening becomes Open.
- Linear completed/canceled workflow states become Done; triage, backlog, unstarted and started
  states become Open. Outbound changes use the chosen open/done workflow states.
- Azure DevOps Resolved/Completed categories become Done; Proposed/InProgress become Open.
  The explicitly selected open/done states are recognized directly. Removed and unknown states
  do not change uier. Outbound changes use the saved state mapping.
- Notion uses the selected Status or Select property, identified by its stable property id, and
  the selected open/done values. Other values, blank fields and trashed pages do not change uier.
  Save a status mapping before enabling the option; disable the option before unmapping status.

The existing five-minute scheduled worker polls only known managed copies. It does not subscribe
to issue/page webhooks or request extra permissions. Current read/write scopes already cover these
reads; no provider app registration or customer reauthorization is needed. Titles, descriptions,
other fields are not imported by status sync. Reply import has its own independent opt-in. Enabling the option allows the current remote
status to be adopted on the next eligible poll, including on copies sent before enablement.

Polling shares the outbound ledger lease, authority checks, provider budgets and timeouts. A durable
per-provider id cursor rotates through at most 100 accepted ledgers per turn; reads receive at most
one quarter of the provider's call/time allowance (20 calls and 30 seconds maximum). Large queues,
provider limits and cron delays can take multiple runs. Missing, retired, scrubbed and uncertain
copies are never recreated by polling. Poll failures retain outbound progress and bounded diagnostic
codes in `statusSyncCode`/`statusCheckedAt`; they retry on a later cursor cycle.

Before applying a result, recheck the current binding, toggle, enabled state, connecting admin,
destination and shared source. Apply through a conditional comment write with activity, notification
and source-sync markers together. No-op reads create no activity or notifications. Pending uier
mutations take precedence over remote status; a concurrent source write defers the import rather
than overwriting it. An imported change fans out to the other connected services on subsequent
worker runs. With two-way sync on, equivalent Linear and Azure DevOps workflow states are kept
when acknowledging imported changes (for example, Closed stays Closed rather than moving back to
the mapped Resolved state). Cross-system changes are eventually consistent, not atomic.

## Two-way reply sync

All five providers have a separate **Sync replies in both directions** setting, off by default.
It starts with replies created after enabling; it does not backfill old discussions. GitHub and
Linear keep their existing outbound discussion behavior when this setting is off. Notion and Azure
DevOps keep older discussion in the document body, while new enabled replies use native comments.
Slack uses replies under the managed root message and suppresses redundant reply-count summaries.
Disabling this setting stops new reply imports and native reply changes; it leaves status sync and
ordinary outbound copying independent. Turning the whole integration off stops delivery and polling.

Edit or delete the **original** reply to update its copies. A uier reply remains editable in uier;
a provider reply is imported with a source label and remains read-only in uier, including for admins.
Provider APIs restrict apps to modifying their own comments. Provider identities are never mapped
to uier accounts or given member permissions. Plain text is limited to 1,000 characters and the
existing 50-item thread limit. Attachments, reactions and comments on individual Notion content
blocks are excluded. Notion page comments and Slack replies must belong to the exact linked item.

Polling uses the status worker's leases, cursor, budgets and source/authority checks. Each read
visits one page of at most 50 comments and up to three rotating checks of known originals. Missing
items on a list page are not deletion evidence: an exact lookup must confirm absence. Resolved
Notion discussions are not deleted. A batch fills the available thread capacity and reports a diagnostic for additional new replies;
edits and deletions of existing imports continue when the thread is full. Source
edits win races; toggle, privacy, destination, binding or admin changes discard in-flight imports.
Imported status and replies commit together with activity, notifications and source sync markers.
A reply keeps a stable identity for its external target across mapping changes. Own copies and
same-provider imports are filtered to prevent loops; other connected providers receive later source
changes. Edits create activity, while only new replies create reply notifications.

Native copies persist ids, hashes and ownership markers, never reply text in delivery ledgers.
An interrupted create scans for its unique marker before adoption; absence is held for review,
never blindly resent. Cleanup removes known app-owned reply copies before removing the root item,
even after reply sync is disabled. Human originals, provider history and notifications can remain.
Removing an external copy does not cause automatic recreation.

Slack reply access requires an explicit **Allow Slack reply access** reconnect requesting
`channels:history` and `groups:history` as bot scopes. It keeps an existing destination active when
upgrading the same workspace. History grants are wider than one thread, but the worker reads only
known linked threads in the selected channel. No user tokens, DMs, Events API or auto-join permission
are requested. Notion's public connection needs **Read comments** and **Insert comments** capabilities;
existing authorizations may need reconnecting. GitHub Issues read/write, Linear read/write and
Azure DevOps `vso.work_write` already cover their comment operations. See the
[setup steps](integration-setup.md#two-way-reply-sync) for provider registration and acceptance.

## Source outbox

Every eligible non-public project mutation records `syncVersion`, `syncPending` and an indexed
`syncKey` in the same conditional write as the feedback. True no-ops, private-before-and-after
changes, legacy nonproject comments and the public showcase are excluded. Missing legacy
`projectId` is normalized only when the stored partition exactly matches the authorized project.

The source signal deliberately does not depend on a project binding snapshot. A request can
load an unconnected project before an admin attaches a service, then commit afterward. Gating
its source marker on that stale snapshot would lose the change. An unbound source is consumed
without provider calls. This is the implemented correction to the plan's original binding gate.

Hard deletion writes a text-free tombstone with the deletion version and known targets in the
same Cosmos transaction as the conditional delete. Tombstones never appear in ordinary comment
reads. Shared discovery unions captured and current targets, saves each connection's durable
deletion intent, rechecks bindings, then conditionally removes the source tombstone. Its 30-day
TTL bounds recovery; expiry does not prove removal of an external copy.

Deleting a project disconnects each connected service first, then removes its connections, ledgers,
per-project grants and OAuth state. Copies already sent stay with the provider. Discovery drops the
project's tombstones once its code is retired, since no target remains ([project deletion](project-deletion.md)).

## Discovery and delivery

Discovery scans a bounded page ordered by indexed `syncKey`. A durable rotating cursor prevents
an unavailable source/provider at the start of the queue from permanently starving later work.
It leaves a source pending on incomplete fan-out, binding changes, source-version conflicts or
store failures. A final binding read is defensive; it is not a cross-container transaction.
New connections receive subsequent state and explicitly selected backfill, not an implied
historical export. Slack additionally uses each destination generation's activation cutoff.

The scheduled worker runs after email with an eight-minute total integration allowance. Discovery
gets at most 30 seconds and one quarter of the allowance; adapters get fair bounded turns with a
rotating first provider. Due delivery queries are bounded and each provider has its own call,
lease, retry and pause state. A provider/store failure does not skip subsequent provider turns.
Review counts are bounded lower bounds on very large queues.

Each ledger identifies provider, connection, workspace, project and thread. Source versions merge
monotonically. A separate request revision lets a provider-specific backfill force reconciliation
of an already processed version without changing the source flag or notifying another service.
Privacy/deletion work wakes stopped content delivery while retaining its uncertain attempt.

Delivery requires the current binding and connecting admin. It reloads the project, source and
authority at external-call boundaries. Private/deleted content goes through a cleanup context
with no feedback packet. Source/project/configuration changes defer the stale projection. Turning
off waits; disconnecting or losing membership suppresses delivery. An in-flight external request
cannot be recalled, so this is not a cross-system atomic privacy transaction.

Attempts persist operation identity, destination revision, ids, hashes and cursors before send.
They never contain exported feedback, images or credentials. An uncertain create cannot be
blindly replayed. Adapters must reconcile it, including on the cleanup path. A newly prepared
request that this invocation proves was never sent may discard only its own attempt. Checkpoints
and results are lease-fenced and preserve concurrently queued versions/deletion intent.

## Credentials and views

Provider credentials and PKCE verifiers use authenticated AES-256-GCM with random IVs, a key id
and provider/workspace/subject/field-bound context. A fixed fallback key is available only in the
existing local runtime. Deployed configuration fails closed. Explicit previous keys permit a
controlled rotation; no key or plaintext credential appears in DTOs, errors or logs.

OAuth state is random and stored hashed with user/workspace/project/provider/intent binding and
an explicit ten-minute expiry. Atomic consumption scrubs the verifier and retains a consumed
receipt until TTL, preventing a replay or an old callback from deleting a newly started flow.
Grant refreshes use current-authority checks, an expiring lease and a generation fence. A stale
refresh cannot recreate a deleted grant or overwrite a newer grant.

External links use one shared `{ provider, url }` DTO. The loader checks current member/project
access, the binding and source visibility, then requires the adapter's destination-specific HTTPS
validation. Private, deleted, suppressed, disconnected and pending-deletion links are absent.
Guests and the public showcase receive none. A link grants no provider access.

## Validation

`integrationSignals.api.spec.ts` covers source mutations, stale snapshots, privacy/no-op rules,
store bounds and transactional tombstones. `integrationCredentials.api.spec.ts` covers tampering,
key/context isolation, OAuth replay/expiry and refresh lease races. `integrations.api.spec.ts`
exercises fan-out failures, source/binding races, leases, privacy cleanup, uncertainty, backfill,
provider fairness and link safety with instrumented adapters and the real authorized export.

`notion.api.spec.ts`, `github.api.spec.ts`, `linear.api.spec.ts`, `slack.api.spec.ts` and `azure-devops.api.spec.ts` use actual
HTTP requests to local provider simulators. The matching browser specs cover OAuth returns,
explicit destination controls, permission checks, persistent settings and disconnect;
`integration-settings.spec.ts` covers the overview's grid and connected list. Playwright
uses generated fixture credentials and loopback simulators; it never needs real provider tokens.
The simulators have no rate limits, so `playwright.config.ts` turns off the request spacing that
the Notion, Linear and Azure DevOps clients keep on a deployment (`NOTION_REQUEST_INTERVAL_MS`,
`LINEAR_REQUEST_INTERVAL_MS` and `AZURE_DEVOPS_REQUEST_INTERVAL_MS` set to `0`, honoured only in
local runtime). Linear and Azure DevOps took half of the required suite's time before that.

Local and CI checks prove the code paths exercised. Provider-specific hosted acceptance,
registration, credentials, distribution approval and deployment readback remain separate evidence.

## Fix verification and two-way status

Provider packets add authorized verification details while keeping the provider-native status
Open/Done. In progress and Ready to verify map to Open, and same-status polls keep them. A remote closure (which also ends In progress) is ordinary Done without reviewer
confirmation; a remote reopen invalidates a current confirmation claim. Same-status polls do
not change a pending request, advance its revision or create events. In-flight local requests
win over an older status read through the existing source-version/pending-write boundary.

The shared import path uses the same ordinary-status transition as app, bulk and MCP status.
Only the requested reviewer or an explicitly attributed independent admin can create a
confirmation inside uier. No provider status can do so. Names, summaries and fix links remain
untrusted literal content in provider projections, and privacy cleanup keeps its existing
scrub/close semantics rather than promising erasure of remote history.
