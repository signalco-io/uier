# infra - agent guide

The Pulumi program for project `uier`, stack `organization/uier/uier-production`. It is a
standalone pnpm project (own `package.json` and lockfile), deliberately outside the workspace
so web development never installs Pulumi dependencies.

It manages:

- the Vercel project `uier` (root directory `apps/web`, Node 24, region `dub1`) with the
  domains `uier.io` and `www.uier.io` (a `308` redirect to `uier.io`), and the comments API
  variables (production: `COSMOSDB_CONNECTION_STRING` with the primary key and `comments`,
  preview: the managed identity below and `comments-preview`, each its own `UIER_COMMENTS_SECRET`),
  the app's `COSMOSDB_APP_CONTAINER` (`app` / `app-preview`) and, for production only, the email
  variables `ACS_CONNECTION_STRING` and `UIER_EMAIL_SENDER`, and `ANTHROPIC_API_KEY` (rewrite
  suggestions) when the repository secret `ANTHROPIC_API_KEY` is set (passed to Pulumi as env);
- the production-only sensitive `UIER_STAFF_EMAILS` variable from required secret Pulumi config
  `uier:staffEmails`. Never store staff addresses in plaintext. See README "Removing abusive
  comments" for encrypted config updates, rollout and verification;
- the Cloudflare DNS records for `uier.io` and `www.uier.io` (DNS only, not proxied);
- the Azure resource group with a serverless Cosmos DB account (database `uierdata`,
  containers `comments` and `comments-preview` partitioned by `/domain`, `app` and
  `app-preview` partitioned by `/pk`) and Azure Communication Services Email with an
  Azure-managed sender domain (`src/email.ts`).

Preview deployments get no account key: they use a user-assigned managed identity that trusts
the Vercel OIDC token of the project's preview deployments (federated identity credential) and
has the built-in Data Contributor role on `comments-preview` and `app-preview` only (and no
email key). Never give previews a
connection string again; the federated credential hardcodes the Vercel team slug, project name
and team issuer mode, so update it when those change.

`src/productionCosmosIdentity.ts` prepares a separate protected identity trusted only for
`owner:signalco:project:uier:environment:production`, with built-in Data Contributor on `comments`
and `app` only. Production still uses its connection string until the staged cutover in
[`docs/ci-credential-rollout.md`](../docs/ci-credential-rollout.md). Preparation must create exactly
the identity, federation and two data-plane assignments; no authentication flag or Vercel value
changes. The existing connection-string variable now has `deleteBeforeReplace` in preparation
for a later change; keep its sensitivity/value unchanged in this deploy. Verify the CI preview.

Never disable local authentication or key-based metadata writes until production, the scheduled
worker, moderation operators and the restore procedure all work with Entra ID. Deploy each
stage through CI and record readback before removing a credential, subject or key. Pulumi
protection is not an Azure management lock; the rollout records the separate owner prerequisite.

The toolbar bundle needs no infrastructure of its own: the web app serves it at
`https://uier.io/toolbar.js` from Vercel's CDN.

The preview `COSMOSDB_ENDPOINT` is read with `getDatabaseAccountOutput` using the account's
stable name, like the production connection-string lookup. Avoid wiring it to the resource's
computed `documentEndpoint`: account settings updates make that output unknown during preview
and can propose an extra Vercel variable update. The lookup still reads Azure's actual endpoint;
do not suppress endpoint drift with `ignoreChanges` or hardcode an account URL.

## Rules

- **CI applies changes.** Pull requests get a `pulumi preview` posted as a comment; pushes to
  `main` run `pulumi up` before the website deploys. Do not run `pulumi up` locally.
- Data-holding and domain-serving resources are `protect`ed; a change that would delete or
  replace one fails on purpose. Do not remove `protect` to make a change go through.
- No credentials in config or code: Pulumi, the state backend and the secrets provider use
  the current Azure login (GitHub OIDC in CI, `az login` locally); Vercel and Cloudflare tokens
  come from `VERCEL_API_TOKEN` and `CLOUDFLARE_API_TOKEN`, the Anthropic key from `ANTHROPIC_API_KEY`
  (repository secrets passed in by `.github/workflows/pulumi_reusable.yml`).
- Pulumi runs the compiled `dist/index.js` (`typescript: false`), so build before a preview:
  `pnpm preview` does both.
- Keep the Pulumi CLI version pinned in `.github/workflows/pulumi_reusable.yml` equal to
  `@pulumi/pulumi` in `package.json`.
- Backup policy changes follow the [Backups and restore](../docs/backups-and-restore.md)
  runbook. Periodic to continuous is one-way: use a policy-only PR without auto-merge and require
  the owner's approval of the exact CI preview (one in-place account update, no other changes).
  Close it on replacement or unrelated changes. Never remove protection or change policy manually.
- If that deploy fails or times out, do not rerun it. Read `backupPolicy.migrationState`, report
  it to the owner, and hold every push/merge to main (including Renovate) and manual deploy until
  resolved. Only a successful deploy, live policy readback and a no-diff account preview establish
  completion. CI keeps Contributor on the uier resource group; no restore role or restore workflow.
- Restores belong to a named human operator with separate restore and target-write access.
  Test only `comments-preview`, in a temporary West Europe account/group with TTL disabled there.
  Copy only approved accidental deletions with their remaining TTL; never revive author deletions
  or erasure requests. Public backup claims wait for live policy confirmation; record real drill
  evidence and cleanup separately from the procedure.
  Temporary copy-back access uses private connectivity or an exact operator-IP firewall rule,
  applied with public access in one update and verified before reads. Never open the restored
  account with an empty/broad allowlist. Delete its entire temporary resource group afterwards.

The [infrastructure and operations guide](../docs/operations.md) has the full setup, role
assignments and the OIDC subjects CI uses.


## Email rollout (#132)

`src/email.ts` retains the protected root `uier.io` domain and its DNS records, and manages a
separate protected `notify.uier.io` domain for all transactional mail: sign-in links, invitations,
guest confirmations and review digests. The subdomain is active with display name `uier`; the
Azure-managed domain remains linked and the communication-service name/key are unchanged.
Never rename/remove the existing root or managed resources.

The subdomain's ownership TXT, SPF TXT and both DKIM CNAME values come from ACS `verificationRecords`.
Azure's relative DKIM owners must be qualified as `<selector>._domainkey.notify.uier.io` in the
parent `uier.io` Cloudflare zone. `emailDns.ts` preserves the legacy root resource inputs and rejects
owners outside the explicitly selected sending domain. ACS omits DMARC from the live record response;
the owner policy is `_dmarc.notify.uier.io TXT "v=DMARC1; p=reject"`. No report mailbox is assumed.
Authoritative preflight on 29 October 2026 found no existing TXT/SPF, DKIM or DMARC records at the
new owners on either Cloudflare server. Recheck before applying and import/merge any external record;
never add duplicate SPF or DMARC policies.

On 29 October the owner approved replacing the unsupported Azure DMARC-state gate with independent
authoritative DNS validation. The main-only **Verify email domain** workflow verifies Domain, SPF,
DKIM and DKIM2 for `notify.uier.io`, then `emailDmarc.ts` requires one full rejection policy at both
configured Cloudflare authoritative servers. Do not call `initiateVerification(DMARC)` or require
its `NotStarted` state to become Verified. Preserve the published policy; this defers only Azure's
unsupported verification, not DMARC protection. `pnpm build && pnpm test` covers these DNS boundaries.

Preparation #193 deployed on 29 October with six creations and 59 resources unchanged. Verification
run 40864313704 passed all four Azure states and authoritative DMARC. Cutover #178 and the default
sender import repair #196 deployed successfully in run 40866577521. The protected default
`donotreply` SenderUsername is now tracked by Pulumi with username `DoNotReply` and display name
`uier`; its one-time import option has been removed. Every run still reads the domain fresh,
requires the four Azure checks and authoritative DMARC, and retains the Azure-managed domain in
`linkedDomains`. Production uses `donotreply@notify.uier.io`. The sender variable depends on
successful domain linking so scheduled workers cannot use the new address prematurely. Configure
display names in ACS's SenderUsername resource, never by putting a formatted name into the SDK's
`senderAddress`. Review an in-place service update; reject
replacement, deletion, key rotation, connection-string replacement or unrelated changes. No local
`pulumi up`, protection bypass, new reply mailbox or engagement tracking.

The report receiver's credential, expected subscription name and ACS topic remain production-only.
`acsEmailReports` uses Event Grid schema, only delivery reports, TLS 1.2, one event per batch and
30 attempts / 24 hours of retries with a secret static header. Its authenticated validation-only
readiness probe sends no email, writes no app data, rejects redirects and skips network calls in
previews. The probe supplies uppercase subscription metadata; receivers compare Azure resource names
case-insensitively but still require the exact subscriber identity and ACS topic for reports.
Readback on 28 October confirmed Succeeded and a real HTTP 200 handshake after #186/#187. See the
[provisioning receipt](../docs/review-notifications.md#delivery-report-provisioning-receipt).

Subscription provisioning does not prove real delivery. Keep `UIER_EMAIL_REPORT_MATCH_OPERATIONS`
unset until an authorized production digest proves report `messageId` equals the send operation id.
Azure creates the default sender automatically; adoption must import exactly the selected
domain's `/senderUsernames/donotreply` ID. Never recreate/delete the default sender or bypass
protection. Require a no-diff preview when removing a completed one-time import.

Received-message SPF/DKIM/DMARC, unsubscribe header integrity and DKIM header coverage remain separate
acceptance gates. The [operations guide](../docs/operations.md#email-domain-verification-and-cutover)
and [rollout evidence](../docs/review-notifications.md#staged-rollout-and-live-evidence) track the stages.

## Connected service credentials

`src/integrations.ts` adds only production Vercel environment variables and four stable protected
`RandomBytes` resources for Notion, Linear, Slack and temporary GitHub setup encryption. Keep the
logical resource names, 32-byte lengths and protection unchanged. They remain registered while a
provider is disabled or an explicit key override is active. Never replace a key to fix a preview.

The optional GitHub repository secret `UIER_INTEGRATION_ENV` is passed only to the Pulumi job by
`ci.yml` / `deploy.yml` through `pulumi_reusable.yml`. It must be a JSON string map of the strict
provider credential / rotation allowlist in `src/integrations.ts`. The program rejects unknown names,
local endpoint overrides, empty/non-string values and invalid or colliding key ids without echoing
submitted names or values. All supplied values are Pulumi secrets and production-only, retrievable encrypted Vercel
variables (`sensitive: false`). The scheduled worker pulls production variables; write-only Sensitive
values are omitted from that pull and would break delivery. Authorized Vercel members and the worker
can retrieve these server-only values. Never log or upload the ephemeral pulled environment file. `UIER_DEPLOYMENT_ENV=production` is set separately; it is never customer-controlled.

No secret is needed to generate the four encryption keys. Each starts at `k1`. An explicit key
rotation requires the current key and id together; a retained previous key and id are also paired,
with different current/previous ids. Retain the override until old ciphertext and in-flight setup
receipts no longer need it. Removing provider credentials disables that provider on the next deploy;
it does not revoke external grants or clean up external content. See
[connected service setup](../docs/integration-setup.md) for registration, activation and key rotation.

Review the CI preview before merge: this change may add only the integration Vercel variables and
four protected random-key resources. Existing databases, backups, domains, email resources, identities
and protection must have no unrelated changes. Do not apply infrastructure locally or bypass a
failed protection check.


