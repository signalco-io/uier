# Connected services

## Implementation status

The shared synchronization foundation is implemented. Provider-specific delivery, connection
flows and settings are being implemented against these plans:

| Provider | Contract | Status |
| --- | --- | --- |
| [Notion](notion-integration-plan.md) | One page per thread, kept current | Provider implementation pending |
| [GitHub](github-integration-plan.md) | One-way issue mirror | Provider implementation pending |
| [Linear](linear-integration-plan.md) | One-way issue mirror | Provider implementation pending |
| [Slack](slack-integration-plan.md) | Bounded channel notifications | Provider implementation pending |

The production registry remains empty until a complete adapter is ready. This foundation alone
does not authorize provider access or send feedback to an external service.

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

Local and CI checks prove the code paths exercised. Provider-specific hosted acceptance,
registration, credentials, distribution approval and deployment readback remain separate evidence.
