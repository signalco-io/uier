# Connected services

## Implementation status

The shared synchronization foundation, five adapters, OAuth routes and admin-only project settings
are implemented. Each provider stays unavailable until its deployment configuration is valid:

| Provider | Contract | Status |
| --- | --- | --- |
| [Notion](notion-integration-plan.md) | One page per thread, kept current | Implemented; registration and hosted acceptance required |
| [GitHub](github-integration-plan.md) | One-way issue mirror | Implemented; GitHub App registration and hosted acceptance required |
| [Linear](linear-integration-plan.md) | One-way issue mirror | Implemented; app registration and hosted acceptance required |
| [Slack](slack-integration-plan.md) | Bounded channel notifications | Implemented; rotating bot credentials, distribution approval and hosted acceptance required |
| [Azure DevOps](azure-devops-integration-plan.md) | One-way work item mirror | Implemented; Microsoft Entra app registration and hosted acceptance required |

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
  default. No history, direct-message or file scope is requested. The app must already be a channel
  member. Channel changes start a new activation cutoff; edits to older threads stay silent unless
  an admin explicitly selects backfill or resumes a cleaned thread. Missing bot messages are held
  for review. An uncertain post cannot be found automatically without history access, so an admin
  must adopt its known timestamp or explicitly attest absence before another post is allowed.
  Fresh channel metadata is checked before content writes; a channel becoming shared or otherwise
  ineligible stops those writes while known-copy cleanup remains possible.
- **Azure DevOps:** Microsoft Entra ID OAuth with delegated `vso.work_write` and `vso.profile`
  scopes, so work items are written as the connecting admin's work or school account. Each project
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
explicit destination controls, permission checks, persistent settings and disconnect. Playwright
uses generated fixture credentials and loopback simulators; it never needs real provider tokens.

Local and CI checks prove the code paths exercised. Provider-specific hosted acceptance,
registration, credentials, distribution approval and deployment readback remain separate evidence.
