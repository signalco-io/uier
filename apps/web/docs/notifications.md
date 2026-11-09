# Review notifications

Review notifications live in `src/lib/notifications/`. Event metadata is part of the same comment
write as the shared unread activity cursor. Never send email from a toolbar client or detached
promise. The scheduled `Review notifications` workflow runs the awaited Cosmos-backed worker with
the existing production configuration. Dispatch rechecks access, private visibility, subscription,
mute and `getReadSequence`; keep the optional verified guest flow separate from posting. See
`docs/review-notifications.md` for the event/delivery contract and failure evidence.
`/api/email/reports` checks its secret header and expected Event Grid subscription before validation
or writes. Compare the subscription name case-insensitively, as Azure resource identity requires.
The per-subscription credential and expected name bind the handshake to the subscriber; do not
treat validation topic metadata as identity.
Delivery reports must additionally use the configured ACS topic. Rejection logs contain only
bounded reason codes, never header values, addresses, payloads or provider status messages. Bounces suppress only by normalized address hash and bounded reason; report
receipts retain hashed event/operation ids for 30 days and survive a mailbox confirmation. No raw
provider message, address or report payload may be logged. Skip suppressed digests; a failed read
must retry. Show the generic notice only in the admin invite action. Requested sign-in/guest
confirmation remain available and clear suppression only on completed mailbox proof. Ledger
matching is production-gated until live message-id correlation is proven.
The scheduled worker is packaged before credentials are loaded, then runs without a checkout in
`production-worker`, a main-only environment with no approval gate. Its separate Azure app uses
OIDC plus `AzureCliCredential` for Cosmos and Blob data access; deployed requests keep Vercel
federation through `azureDataCredential`. It accepts no Cosmos/Blob account key or dotenv file.
`UIER_WORKER_SETTINGS` contains only allowlisted data, transport and integration-crypto settings;
`scripts/worker-settings.mjs` masks each value before loading it, except the `"0"`/`"1"`
`SLACK_DISTRIBUTION_APPROVED` gate (masking `1` hid exit codes and delivery ids). Only a run's own
failed or ambiguous attempts fail it; ledgers already waiting for review are named as warnings with
their `retry_delivery` id on every run. No Vercel token or environment
pull is available. Refresh the snapshot after credential/crypto changes with
`pnpm -C infra exec node scripts/configure-worker.mjs`; never replace app keys to repair a worker.
Every run validates data scopes first; `verify_only` stops before writes or dispatch.
`integrations_only` manual runs skip email and reject a simultaneous email retry.
MCP event webhooks are swept after integrations on every run except `verify_only` (60 seconds); a
subscriber's failing endpoint never fails a run, only an unexpected worker error does.
GitHub Settings can reuse installations known to the current
workspace, but fresh PKCE user authorization and repository administration checks remain required.
Digest unsubscribe headers are persisted in `attempt.message.headers`; retries preserve them.
`/api/notifications/unsubscribe` changes state only on a cookie-free RFC 8058 POST; GET and
`/notifications` remain read-only. Never accept verify tokens for unsubscribe/mute.
Digest wording uses only the recipient's eligible batch and current authorized participant names;
never name other mention/assignment recipients. Events store item/new-assignee ids, never text.
`emailCommentExcerpts` defaults off and is saved through `adminProject`; commenters see its state.
New attempts rebuild from fresh settings/items at the send boundary; retained provider operations
keep their exact message, which can retain opt-in excerpts until reconciliation without a TTL.
