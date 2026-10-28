# Infrastructure and operations

Maintainer reference for infrastructure, deployment, service checks and moderation. Local web
development needs none of these credentials; see [local development](development.md).
For recovery procedures, use [Backups and restore](backups-and-restore.md).

## Infrastructure

[`infra/`](../infra) is the Pulumi project **`uier`** (Node.js runtime) with a single stack,
**`organization/uier/uier-production`**. It manages:

- the Vercel project **`uier`** (`prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc`, root directory `apps/web`, Node.js 24,
  function region `dub1`), its domains `uier.io` and `www.uier.io` (a permanent `308` redirect to `uier.io`
  that keeps the path and query) and the comments API variables: production gets `COSMOSDB_CONNECTION_STRING`
  (the Cosmos DB account's primary key) and `COSMOSDB_COMMENTS_CONTAINER=comments`, preview gets
  `COSMOSDB_ENDPOINT`, `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` (the managed identity below) and
  `COSMOSDB_COMMENTS_CONTAINER=comments-preview`, and each gets its own random `UIER_COMMENTS_SECRET`.
  The app's data container is `COSMOSDB_APP_CONTAINER` (`app` / `app-preview`); only production gets the
  email variables `ACS_CONNECTION_STRING` and `UIER_EMAIL_SENDER`, and `ANTHROPIC_API_KEY` (rewrite
  suggestions) once the repository secret `ANTHROPIC_API_KEY` is set,
- the Cloudflare DNS records for `uier.io` (`A 76.76.21.21`) and `www.uier.io` (`CNAME cname.vercel-dns.com`),
  both DNS only (not proxied), so Vercel terminates TLS and renews the Let's Encrypt certificates itself,
- the Azure resource group `uier-production8b2f56d6` (Pulumi logical name `uier-production`) with a
  serverless Cosmos DB account (database `uierdata`, containers `comments` with per-item TTL enabled
  (`defaultTtl: -1`) and `comments-preview` (`defaultTtl` 7 days), both partitioned by `/domain`; the app's
  `app` (`defaultTtl: -1`) and `app-preview` (`defaultTtl` 7 days), both partitioned by `/pk`) and the
  user-assigned managed identity `uier-preview-cosmos...` of preview deployments: a federated identity
  credential for the Vercel OIDC token of the project's preview deployments and Cosmos DB data plane role
  assignments (built-in Data Contributor) on the `comments-preview` and `app-preview` containers,
- Azure Communication Services Email for the app's sign-in links and invitations (`infra/src/email.ts`): an
  email service with an **Azure-managed sender domain** (`DoNotReply@<id>.azurecomm.net`), linked to a
  communication service. A protected customer-managed `uier.io` domain and its ownership TXT, SPF TXT,
  DKIM CNAME and DKIM2 CNAME records come directly from ACS `verificationRecords`. DMARC uses its
  supplied record when present; the live API currently omits it, so `emailDns.ts` supplies the explicit
  owner policy `_dmarc.uier.io TXT "v=DMARC1; p=reject"`. No report mailbox is invented.
  The Azure-managed domain remains the production sender until the staged verification below is complete.
  The report endpoint receives production-only `UIER_EMAIL_REPORT_SECRET`, `UIER_EMAIL_REPORT_TOPIC`
  and `UIER_EMAIL_REPORT_SUBSCRIPTION`. The Event Grid subscription was staged after receiver
  deployment and authenticated validation binding. CI first checks an authenticated validation-only
  readiness probe, then provisions the subscription with its secret static header and bounded retries
  (30 attempts / 24 hours). The probe sends no email and writes no app data. It uses uppercase name
  metadata to confirm the deployed receiver applies Azure's case-insensitive resource identity.
  Independent Azure readback on 28 October 2026 confirmed subscription `uier-email-delivery` is
  `Succeeded`; both the readiness request and real validation callback returned 200. See the
  [provisioning receipt and remaining gates](review-notifications.md#delivery-report-provisioning-receipt).

### Email domain verification and cutover

Before applying DNS, query the authoritative Cloudflare nameservers for apex TXT and `_dmarc.uier.io`
TXT. On 28 October 2026 neither had an SPF/DMARC record. Recheck before deployment: if another sender
has added one outside Pulumi, import that record and merge the policy in a reviewed PR. Never create
a second SPF policy or DMARC record. Preserve other senders and the existing DMARC policy.

Deploy the domain and all five DNS records described above through CI with `UIER_EMAIL_SENDER` unchanged.
Run the main-only **Verify email domain** workflow after the DNS deployment. It uses Azure OIDC
to check the provisioned records: ownership first, then SPF, DKIM, DKIM2 and DMARC. Read
`verificationStates` back from Azure until each
reports `Verified`; a DNS response alone is insufficient. On 28 October 2026 Azure verified the
first four, but rejected DMARC verification with `Invalid verification type: DMARC` despite listing
that value in its 2026-03-18 API. DMARC remains `NotStarted`; sender cutover remains blocked. Do not edit protected resources manually
or run `pulumi up` locally. The verification action only checks the provisioned DNS.

Prepare a separate cutover PR that reads the live domain with `getDomainOutput`, fails unless all
five states are `Verified`, adds its id to the existing communication service's `linkedDomains`
while retaining the Azure-managed domain, and sets `UIER_EMAIL_SENDER` to `DoNotReply@uier.io`.
Its reviewed preview must show an in-place communication service update: reject a replace/delete,
resource rename, key rotation or connection-string replacement. Keep engagement tracking disabled.

Ship `/api/email/reports` before a second PR creates its Event Grid subscription: infra runs before
Vercel on every deployment, and Event Grid validates the receiver immediately. Check
`Microsoft.EventGrid` registration first. The subscription uses only delivery reports and a secret
static `x-uier-email-report-secret` header. Never put the secret in a URL or a log. See
[the rollout and production acceptance gates](review-notifications.md#staged-rollout-and-live-evidence)
for authorized recipient testing, message-id correlation, SPF/DKIM/DMARC and header evidence.
Keep `UIER_EMAIL_REPORT_MATCH_OPERATIONS` unset until correlation is proven, then enable it through
a reviewed production-only Pulumi change.

### Infrastructure state and credentials

State lives in the self-managed backend `azblob://states` (storage account `sastate2a61d506`) and stack
secrets are encrypted with the Azure Key Vault key `vault-pulumib5f713d9/pulumi-backend`. Nothing in the
stack config holds Azure credentials: Pulumi, the state backend and the Key Vault secrets provider all use
the current Azure login (GitHub OIDC in CI, `az login` locally). The Vercel and Cloudflare providers read their tokens from
`VERCEL_API_TOKEN` and `CLOUDFLARE_API_TOKEN`.

Running a preview locally (needs `Storage Blob Data Contributor` on the `states` container, `Key Vault Crypto User`
on the key and `Contributor` on the uier resource group):

```bash
az login --tenant c7837eb3-77ca-413b-8653-c97b08886678
export AZURE_STORAGE_ACCOUNT=sastate2a61d506
export VERCEL_API_TOKEN=<vercel token with access to the signalco team>
export CLOUDFLARE_API_TOKEN=<cloudflare token with DNS edit on uier.io>

cd infra
pnpm install
pulumi login azblob://states
pnpm preview   # pnpm build && pulumi preview --stack organization/uier/uier-production
```

Pulumi runs the compiled `dist/index.js` (`typescript: false` in `Pulumi.yaml`), so always build before a
preview; `pnpm preview` does that. The data-holding and domain-serving resources (resource group, Cosmos DB
account, database and containers, Vercel project, `uier.io` DNS record) are `protect`ed: a change that would
delete or replace one of them fails instead of being applied.

CI applies changes (`pulumi up`); do not run it locally. See [CI/CD](#cicd).

## CI/CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | pull requests, manual | Web: typecheck, build, Playwright e2e and a Vercel preview deployment (URL in the job summary). Infra: `pulumi preview` against `uier-production`, posted as a PR comment. `CI OK` aggregates all jobs. |
| [`deploy.yml`](../.github/workflows/deploy.yml) | push to `main`, manual | `pulumi up` first, then build and deploy the website to Vercel production (`uier.io`). |
| [`pulumi_reusable.yml`](../.github/workflows/pulumi_reusable.yml) | called | Installs and builds `infra/`, logs into Azure (OIDC) and runs `pulumi preview` / `up`. |
| [`vercel-deploy_reusable.yml`](../.github/workflows/vercel-deploy_reusable.yml) | called | `vercel pull`, `vercel build`, `vercel deploy --prebuilt --archive=tgz` (reduces file uploads). |

- **`main`** is the only long-lived branch and is production. Pushes run `pulumi up` and a Vercel
  production deployment served on `uier.io`, unless all changed paths are excluded by `deploy.yml`.
- **Pull requests** target `main`. CI uses changed paths to run web checks and a Vercel preview for
  app/workspace changes, and `pulumi preview` for infrastructure changes. PRs from forks only run
  the checks that need no secrets. `CI OK` aggregates the required results, including skipped jobs.

Infrastructure always runs before the website deploy because the Vercel project settings (root directory,
environment variables, domains) are managed by Pulumi. Deployments are made by the Vercel CLI from GitHub
Actions; the Vercel project is not connected to Vercel's Git integration.

Concurrency: deploys run one at a time and are never cancelled; `pulumi up` runs are serialized; a new push
to a pull request cancels its previous CI run.

### Required GitHub configuration

Repository secrets:

| Secret | Used for |
| --- | --- |
| `AZURE_CLIENT_ID` | `azure/login` (OIDC) and the azure-native provider (`ARM_CLIENT_ID`) - Entra ID app **uier GitHub Deployment** |
| `AZURE_TENANT_ID` | `azure/login` (OIDC) and the azure-native provider (`ARM_TENANT_ID`) |
| `AZURE_SUBSCRIPTION_ID` | `azure/login` (OIDC) and the azure-native provider (`ARM_SUBSCRIPTION_ID`) |
| `AZURE_STORAGE_ACCOUNT` | Pulumi state backend `azblob://states` (no account key: access is granted by Azure RBAC) |
| `VERCEL_TOKEN` | Vercel CLI deployments and the Pulumi Vercel provider (`VERCEL_API_TOKEN`); scoped to the signalco team |
| `CLOUDFLARE_API_TOKEN` | Pulumi Cloudflare provider; DNS edit permission on the `uier.io` zone |
| `ANTHROPIC_API_KEY` | Optional: production's `ANTHROPIC_API_KEY` on Vercel (rewrite suggestions), set by Pulumi; until it is set suggestions are not available |
| `UIER_INTEGRATION_ENV` | Optional JSON string map of server-only provider credentials and explicit rotation overrides; Pulumi validates the allowlist and sets production-only retrievable encrypted Vercel variables for the app and scheduled worker. Four stable encryption keys are generated automatically. See [connected service setup](integration-setup.md). |

The Entra ID app **uier GitHub Deployment** needs federated credentials (issuer
`https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`) for the subjects below.
This repository was created after GitHub switched new repositories to *immutable* OIDC subjects, so its
tokens identify the owner and repository by ID (`repo:signalco-io@89613566/uier@1432139886:...`, see
`gh api repos/signalco-io/uier/actions/oidc/customization/sub`) instead of `repo:signalco-io/uier:...`:

| Subject | Used by |
| --- | --- |
| `repo:signalco-io@89613566/uier@1432139886:ref:refs/heads/main` | `deploy.yml` (and manual CI runs on `main`) |
| `repo:signalco-io@89613566/uier@1432139886:pull_request` | `pulumi preview` in `ci.yml` |

and these role assignments:

| Role | Scope |
| --- | --- |
| Contributor | resource group `uier-production8b2f56d6` |
| Key Vault Crypto User | key `pulumi-backend` in `vault-pulumib5f713d9` |
| Storage Blob Data Contributor | container `states` in `sastate2a61d506` |

Contributor on the resource group also covers the preview managed identity, its federated credential and the
Cosmos DB data plane role assignment (`Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/write` is a
Cosmos DB control plane action, not a `Microsoft.Authorization` one, which Contributor excludes).

The workflows do not use GitHub deployment environments; adding `environment:` to a job that logs into Azure
changes its OIDC subject to `repo:signalco-io@89613566/uier@1432139886:environment:<name>`.

Actions settings (Settings -> Actions -> General -> Workflow permissions): the default `GITHUB_TOKEN` should be
**read-only** and must **not** be allowed to create or approve pull requests. Every workflow here declares its
`permissions` explicitly, so this only guards future workflows that forget to:

```bash
gh api -X PUT repos/signalco-io/uier/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

Dependencies are kept current by [Renovate](https://github.com/apps/renovate) (installed for the
`signalco-io` organization; see [`renovate.json`](../renovate.json)). It waits until an npm release is one day
old - the same `minimumReleaseAge` pnpm enforces on install - and automerges selected minor/patch updates.

A ruleset on `main` requires a pull request with a passing **`CI OK`** check and blocks force pushes and deletions; "Allow auto-merge" is enabled on the repository.

## Status

[uier.io/status](https://uier.io/status) and `GET /api/status` show the live state of the services, checked on the
server when they are requested ([`src/lib/status`](../apps/web/src/lib/status/serviceStatus.ts)):

| Service | Check |
| --- | --- |
| Website | none: it answers, so it is up |
| Comments | the comments server key is configured and a point read of a missing document in the comments store answers within 5 s (about 1 RU on Cosmos DB) |

Results are reused for 30 seconds per server instance. `/api/status` returns the report as JSON with `200` when
every service is operational and `503` otherwise (`Cache-Control: no-store`), so an external monitor can poll it.
Nothing is recorded: there is no history or uptime figure, and none is claimed. A failed check is logged as
`[status] Comments API check failed` with the error. If uier.io itself is down, the status page is down too.

## Removing abusive comments

There is no moderation UI yet. Remove comments directly in Cosmos DB:

1. Azure portal -> resource group `uier-production8b2f56d6` -> Azure Cosmos DB account `uierdb...` ->
   **Data Explorer** -> database `uierdata` -> container `comments` (`comments-preview` for preview deployments).
2. **New SQL Query**, e.g. all comments of the landing page:

   ```sql
   SELECT * FROM c WHERE c.domain = 'uier.io' AND c.path = '/' ORDER BY c._ts DESC
   ```

   (`domain` is the host the comment was posted on, e.g. `uier.io`; other useful filters:
   `CONTAINS(c.thread.items[0].text, 'spam')`, `c.authorId = '<authorId of a known abusive comment>'`.
   Rate-limit counters are in the same container (`c.type = 'counter'`, no `path`) and expire by themselves.
   So is each partition's comment numbers' sequence (`c.type = 'sequence'`, id `$sequence_comments`): do not
   delete it, or numbering continues after the highest number still stored. A comment's screenshot is a
   document of its own (`c.type = 'screenshot'`, id `$screenshot_<comment id>`): delete it with the comment.)
3. Open the document and **Delete** it to remove the whole comment, or remove the offending entry from
   `thread.items` and **Update** to remove a single reply. If only a deleted first item (`deletedAt`) would be
   left, delete the document instead. Changes are visible immediately (the API does not cache).

For an accidental operator delete, follow [Backups and restore](backups-and-restore.md#backups-and-restore). Never recover
abuse, an author's deletion or content covered by an erasure request.
