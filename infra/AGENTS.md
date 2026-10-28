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

The [infrastructure and operations guide](../docs/operations.md) has the full setup, role
assignments and the OIDC subjects CI uses.


## Email rollout (#132)

`src/email.ts` first provisions a protected customer-managed `uier.io` domain and Domain/SPF/DKIM/
DKIM2/DMARC DNS records from `verificationRecords` when present. The live 2026-03-18 API omits
DMARC even though it reports a verification state; `emailDns.ts` supplies the explicit owner policy
`_dmarc.uier.io TXT "v=DMARC1; p=reject"` only in that case. No reporting mailbox is assumed.
Keep the missing/malformed checks for the other records. Targeted regression check after build:
`node --test tests/emailDns.test.mjs`. The existing Azure-managed domain, communication
service name, connection string and sender remain. DNS preflight found no apex SPF or `_dmarc` TXT
on 28 October 2026; recheck authoritative DNS and import/merge any externally created policy before
applying. Never add a duplicate SPF or DMARC record.

The report receiver's credential, expected subscription name and ACS topic are production-only.
`acsEmailReports` subscribes only to delivery reports, using Event Grid schema, TLS 1.2, one event
per batch and bounded retries (30 attempts / 24 hours). It shares the receiver's secret header.
Deploy the receiver before adding an Event Grid subscription in a later PR; Pulumi runs before
Vercel and subscription creation immediately calls the validation handshake. Event Grid must be
registered. Deliver the credential as a secret static HTTP header, never a query parameter.

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


Subscription creation was temporarily paused after its first handshake reached the receiver and
returned 403. Deploy the receiver's documented subscription-root topic compatibility before
re-enabling `acsEmailReports` in a later PR. Never weaken report topic, subscription-name or secret
checks, and never remove protection or bypass the staged deployment order.


After #179 deploys the validation-topic compatibility receiver, resume `acsEmailReports` through
CI. Validate its provisioning state independently before claiming the handshake succeeded. Sender
cutover remains a separate five-state gate; delivery-report operation matching stays disabled.


After the second 403, subscription provisioning is paused again for the authenticated validation
binding receiver revision. Validation requires its per-subscription secret and exact subscription
name; report notifications additionally require the configured ACS topic. Resume only after the
receiver deploys. Do not bypass WAF, authentication or the five-state sender gate.
