# Infrastructure and operations

Maintainer reference for infrastructure, deployment, service checks and moderation. Local web
development needs none of these credentials; see [local development](development.md).
For recovery procedures, use [Backups and restore](backups-and-restore.md).

## Infrastructure

The [least-privilege rollout](ci-credential-rollout.md) records the preparation and the remaining
credential and Cosmos DB cutover gates for #167. Production still uses its account key in this stage.

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
  both DNS only (not proxied), so Vercel terminates TLS and renews the Let's Encrypt certificates itself;
  the apex CAA `0 issue letsencrypt.org` restricts issuance to that documented CA (Cloudflare `data`, not `content`),
- the Azure resource group `uier-production8b2f56d6` (Pulumi logical name `uier-production`) with a
  serverless Cosmos DB account (database `uierdata`, containers `comments` with per-item TTL enabled
  (`defaultTtl: -1`) and `comments-preview` (`defaultTtl` 7 days), both partitioned by `/domain`; the app's
  `app` (`defaultTtl: -1`) and `app-preview` (`defaultTtl` 7 days), both partitioned by `/pk`) and the
  user-assigned managed identity `uier-preview-cosmos...` of preview deployments: a federated identity
  credential for the Vercel OIDC token of the project's preview deployments and Cosmos DB data plane role
  assignments (built-in Data Contributor) on the `comments-preview` and `app-preview` containers,
- Azure Communication Services Email for transactional mail (`infra/src/email.ts`): the existing
  protected customer-managed `notify.uier.io` domain is active, and the Azure-managed domain remains
  linked. The protected root `uier.io` domain and its records remain unchanged. The
  subdomain gets ownership/SPF TXT and both DKIM CNAME records from ACS; relative DKIM owners are
  qualified for the parent Cloudflare zone. ACS omits a DMARC record, so the explicit owner policy is
  `_dmarc.notify.uier.io TXT "v=DMARC1; p=reject"`. No reporting or reply mailbox is invented.
  The configured inbox identity is `uier <donotreply@notify.uier.io>`; see the activation receipt below.
- The report endpoint receives production-only `UIER_EMAIL_REPORT_SECRET`, `UIER_EMAIL_REPORT_TOPIC`
  and `UIER_EMAIL_REPORT_SUBSCRIPTION`. The deployed Event Grid subscription uses a secret static
  header, TLS 1.2, one-event batches and bounded retries (30 attempts / 24 hours). CI's authenticated
  validation-only probe sends no email and writes no app data. It uses uppercase subscription metadata
  to check Azure's case-insensitive resource identity. Independent readback on 28 October confirmed
  `uier-email-delivery` is Succeeded and the real validation callback returned 200. See the
  [provisioning receipt and remaining gates](review-notifications.md#delivery-report-provisioning-receipt).

### Email domain verification and cutover

Before applying, query both authoritative Cloudflare servers for `notify.uier.io` TXT,
`_dmarc.notify.uier.io` TXT and both subdomain DKIM owners. The 29 October 2026 preflight found none.
Import/merge externally created policies in a reviewed PR; never add a duplicate SPF or DMARC record.
Keep the existing root-domain records, managed domain, communication service name, keys and connection
string. The preparation preview may create only the subdomain and five DNS records.

Deploy preparation with `UIER_EMAIL_SENDER` unchanged. Run the main-only **Verify email domain**
workflow after DNS exists. It verifies Domain, SPF, DKIM and DKIM2 for `notify.uier.io`, then directly
checks `_dmarc.notify.uier.io` at both configured Cloudflare authoritative servers. The policy must
be a single `v=DMARC1; p=reject` policy (with no partial pct override). Azure rejects DMARC verification
as an invalid type despite listing it in its API; on 29 October the owner approved authoritative
DMARC DNS validation in place of that unsupported Azure state. Waiting for its NotStarted state is
no longer a cutover condition. Keep the DMARC policy published.

A separate cutover PR reads the subdomain fresh with `getDomainOutput` and fails unless all four
supported Azure checks and authoritative DMARC DNS pass. Configure the default sender resource's
display name as `uier`, retain the Azure-managed domain in `linkedDomains`, and set production
`UIER_EMAIL_SENDER` to `DoNotReply@notify.uier.io`. Both the direct transactional sender and the digest
transport use this variable. Its preview must update the communication service in place; reject
replace/delete, resource renames, key rotation, connection-string replacement or unrelated changes.
Display-name setup imports Azure's already-created default SenderUsername before updating it, then
removes the import option after successful adoption. It never recreates the default sender or puts a
formatted `senderAddress` string in the application.
Keep engagement tracking disabled. Apply through CI; never run `pulumi up` locally.

Cutover #178 initially failed because Azure had already created the default sender. Repair #196
imported that exact resource and updated it in place. [Deployment 40866577521](https://github.com/signalco-io/uier/actions/runs/40866577521)
succeeded on 29 October 2026. Independent readback confirmed display name `uier`, the new domain
link and production `UIER_EMAIL_SENDER=donotreply@notify.uier.io`. The completed one-time import
option is removed from source; the sender remains protected and managed by Pulumi. See the
[activation evidence](review-notifications.md#transactional-sender-activation).

A recipient-authorized production digest remains necessary to prove report message-id correlation,
received-message SPF/DKIM/DMARC, intact unsubscribe headers and DKIM coverage. Keep
`UIER_EMAIL_REPORT_MATCH_OPERATIONS` unset until correlation is proven. Subscription provisioning
alone does not satisfy those acceptance gates.

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
This protects against Pulumi changes only. Azure `CanNotDelete` locks on the resource group and
`uierdb` have not been established by this change; do not describe them as active without readback.

The next CI deployment also provisions a separate protected `uier-production-cosmos...` managed identity,
its Vercel production federation and built-in Data Contributor assignments on `comments` and `app` only.
It receives no control-plane role or preview-container access. Its existence does not switch production
authentication: the Vercel variables and scheduled worker still use the existing connection string.

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

These are the current credentials. The [credential rollout](ci-credential-rollout.md) describes the
target environments, subjects, role scopes and secret migration. Prepare and verify them before
changing workflow authentication; repository secrets cannot be read back through GitHub's API.

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
Only development dependencies matching `@types/*`, `@playwright/test` and `@axe-core/playwright` can
automerge, after at least **three days**, for minor, patch, pin or digest updates. Runtime packages,
build/deployment tools, Pulumi providers and all GitHub Actions updates wait for a maintainer to merge.
Every external workflow action is pinned to a full commit SHA with a version comment; Renovate's
`helpers:pinGitHubActionDigests` keeps those references updated through pull requests.

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

1. Sign in with an allowlisted staff account. Switch to the **uier** workspace and open
   **uier.io public feedback**. Choose **All environments** to include feedback from local or
   historical addresses. App feedback is visible only to its author and staff.
2. In a comment's actions, choose **More from this author** to see threads they opened or replied
   to. Replies offer the same action. This admin-only filter is applied before the 1000-thread
   listing limit. Its URL contains a random, account/project-bound reference that expires after
   24 hours; stored account and guest author ids stay on the server. Clear the author filter to
   return to everyone. The normal environment, people and page filters still apply.
3. Choose **Delete** and confirm to remove a whole thread and its screenshot. Expand replies,
   open a reply's actions and choose **Delete reply** to remove only that reply. Comment numbers
   and rate-limit counters are retained. **Make private** hides a thread from other commenters;
   feedback on `/app` pages remains private even when its explicit private flag is off.

The public workspace has no Users page, invitations, member removal or project creation. Its
project settings are fixed; each member can still manage their own notification preference.
An old invitation cannot assign an admin role. Customer workspaces keep their usual rules.

**Add or remove staff:** the list is production-only and is the only source of public-project
admin access. Keep it short: anyone with access to an allowlisted inbox can sign in as staff.
An authorized owner must supply today's staff list before this release is merged. The Pulumi
program requires the config key, so a missing key blocks preview/deployment rather than silently
shipping an empty list.

1. From `infra/`, with the documented Azure backend and secrets provider configured, run
   `pulumi config set staffEmails --stack organization/uier/uier-production --secret`.
   Enter the complete comma-separated list at the hidden prompt, adding or removing the intended
   addresses. Do not put addresses in shell arguments, source, PR text, logs or plaintext config.
2. Commit only the encrypted `uier:staffEmails` entry in `infra/Pulumi.uier-production.yaml` through
   a reviewed PR. CI previews and applies it; never run `pulumi up` locally. Pulumi sets the
   sensitive Vercel variable `UIER_STAFF_EMAILS` for **production only**, before the new web deployment.
3. Verify the new production deployment: a retained staff account can moderate, and a removed
   account cannot read another person's private feedback, including with an existing review token
   or MCP credential. Changes take effect when the new deployment is live. The next app request
   and each instance's first provisioning call reconcile stored memberships as well.

Addresses are trimmed, lowercased and checked with `emailSchema`; malformed entries are skipped.
A missing or empty runtime variable means no staff. Public pages, sign-in and personal workspaces
still work. Previews receive no production staff list. Intentionally removing all staff requires
an explicit empty secret value and leaves moderation unavailable until a staff list is deployed.

**Cosmos DB fallback:** use Data Explorer only when the app procedure is unavailable.

1. Open database `uierdata`, container `comments` (`comments-preview` for previews).
2. Query the exact public project partition and thread id:

   ```sql
   SELECT * FROM c WHERE c.domain = 'project:uier00000001' AND IS_DEFINED(c.path)
     AND c.id = '<comment id>'
   ```

   Legacy source documents under `uier.io` were copied once and remain untouched; current public
   feedback is in `project:uier00000001`. Confirm the partition and document id before any write.
3. Delete only that comment and its `$screenshot_<comment id>` document in the same partition.
   To remove one reply, remove its entry from `thread.items` and update the comment. If that leaves
   only a deleted first-item placeholder, delete the thread and screenshot instead.
   Never delete `$sequence_comments` or rate-limit counter documents. Refresh the app/API to
   confirm the thread or reply is gone, its screenshot returns not found when the thread went,
   and the next comment continues numbering. The API does not cache these reads.

For an accidental operator delete, follow [Backups and restore](#backups-and-restore). Never recover
abuse, an author's deletion or content covered by an erasure request.


For an accidental operator delete, follow [Backups and restore](backups-and-restore.md#backups-and-restore). Never recover
abuse, an author's deletion or content covered by an erasure request.
