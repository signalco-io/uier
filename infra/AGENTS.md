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

`src/email.ts` first provisions a protected customer-managed `uier.io` domain and Domain/SPF/DKIM/
DKIM2/DMARC DNS records from `verificationRecords` when present. The live 2026-03-18 API omits
DMARC even though it reports a verification state; `emailDns.ts` supplies the explicit owner policy
`_dmarc.uier.io TXT "v=DMARC1; p=reject"` only in that case. No reporting mailbox is assumed.
Keep the missing/malformed checks for the other records. Regression checks after build: `pnpm test` covers email DNS and the integration credential-map boundary. The existing Azure-managed domain, communication
service name, connection string and sender remain. DNS preflight found no apex SPF or `_dmarc` TXT
on 28 October 2026; recheck authoritative DNS and import/merge any externally created policy before
applying. Never add a duplicate SPF or DMARC record.

The report receiver's credential, expected subscription name and ACS topic are production-only.
`acsEmailReports` subscribes only to delivery reports, using Event Grid schema, TLS 1.2, one event
per batch and bounded retries (30 attempts / 24 hours). It shares the receiver's secret header.
Deploy the receiver before adding an Event Grid subscription in a later PR; Pulumi runs before
Vercel and subscription creation immediately calls the validation handshake. Event Grid must be
registered. Deliver the credential as a secret static HTTP header, never a query parameter.
Validation requires the per-subscription secret and the expected Azure subscription name (case-insensitive); report notifications
additionally require the configured ACS topic. Do not bypass WAF or authentication.

Before creating/updating the subscription, CI applies run an authenticated validation-only readiness
probe; previews skip network probing. The probe uses the existing credential without logging it,
sends no email, writes no app data and rejects redirects. It validates the echoed code and reports
only bounded failure status/reason, never raw response bodies. Build and run
`node --test tests/*.test.mjs` for the readiness and DNS omission checks. Independently read the
subscription's provisioning state before claiming the handshake succeeded.

The main-only **Verify email domain** workflow runs Azure DNS verification through OIDC, serialized
with Pulumi deployments. It never changes DNS, linkedDomains, senders, keys or protection. Read all five
live `verificationStates` until `Verified`. Link and switch only in a separate reviewed PR, using
a fresh `getDomainOutput` guard. Keep the Azure-managed domain linked. The preview must update
`linkedDomains` in place and must not replace the communication service or change its key/connection
string. Never remove protection or apply infrastructure manually. The [operations guide](../docs/operations.md#email-domain-verification-and-cutover) documents
the exact sequence; `docs/review-notifications.md` tracks production evidence. Keep ledger matching
disabled until an authorized production digest proves report `messageId` equals its send operation
id; then enable `UIER_EMAIL_REPORT_MATCH_OPERATIONS=1` for production through Pulumi.


Live verification on 28 October 2026 passed Domain/SPF/DKIM/DKIM2. Azure rejected DMARC's documented
verification type (`InitiateVerificationFailed: Invalid verification type: DMARC`), leaving its
state `NotStarted`. Keep the sender and linkedDomains unchanged until Azure resolves this gate;
a valid public DMARC record does not substitute for the required Azure state.

The case-insensitive Azure resource-name receiver deployed in #186 before #187 created the
subscription. Independent Azure readback on 28 October 2026 confirmed `Succeeded`; the uppercase-name
readiness request and real Azure callback returned 200 and logged only `normalized_subscription_case`.
Keep the uppercase-name probe so later applies confirm that receiver compatibility. Missing/other
names, wrong credentials and report topics still fail. The [provisioning receipt](../docs/review-notifications.md#delivery-report-provisioning-receipt)
separates this handshake from the pending real-digest acceptance. The five-state sender gate and
operation-id correlation gate remain; neither is satisfied by subscription provisioning.

`emailVerification.ts` requires the expected `uier.io` domain and all five live states to be exactly
`Verified` before either linkedDomains or sender changes. Run `node --test tests/*.test.mjs` after
building for DNS omission and strict cutover guard coverage. Do not enable auto-merge on the cutover
PR while its required Azure state/preview gate is failing.

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


