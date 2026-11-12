# Infrastructure and operations

Maintainer reference for infrastructure, deployment, service checks and moderation. Local web
development needs none of these credentials; see [local development](development.md).
For recovery procedures, use [Backups and restore](backups-and-restore.md).
For search engine notifications and analytics status, use [Search discovery](search-discovery.md).
For the operation inventory, safe diagnostics and dated RU measurements, use
[Cosmos query costs](cosmos-query-costs.md).

## Infrastructure

The [least-privilege rollout](ci-credential-rollout.md) records the preparation and the remaining
credential and Cosmos DB cutover evidence for #167. Production Cosmos DB access uses the prepared
Vercel-trusted identity; account-key authentication remains enabled until the stage 5 retirement checks.

[`infra/`](../infra) is the Pulumi project **`uier`** (Node.js runtime) with a single stack,
**`organization/uier/uier-production`**. It manages:

- the Vercel project **`uier`** (`prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc`, root directory `apps/web`, Node.js 26,
  function region `dub1`), its domains `uier.io` and `www.uier.io` (a permanent `308` redirect to `uier.io`
  that keeps the path and query) and the comments API variables: both targets get `COSMOSDB_ENDPOINT`,
  `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` for separate managed identities. Production selects
  `COSMOSDB_COMMENTS_CONTAINER=comments`, preview selects `comments-preview`, and each gets its own
  random `UIER_COMMENTS_SECRET`. Production no longer has `COSMOSDB_CONNECTION_STRING`.
  The app's data container is `COSMOSDB_APP_CONTAINER` (`app` / `app-preview`); only production gets the
  email variables `ACS_CONNECTION_STRING` and `UIER_EMAIL_SENDER` (retrievable, not Sensitive: the
  existing variable sensitivity is retained during credential migration), and `ANTHROPIC_API_KEY` (rewrite
  suggestions and AI thread titles; `UIER_AI_TITLES=off`, set by hand, stops only the titles) once the production-environment secret `ANTHROPIC_API_KEY` is set,
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
  linked. The protected root `uier.io` domain is retained; its single SPF record also authorizes
  Cloudflare Email Routing while preserving the ACS sender include and failure policy. The
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

### Incoming email forwarding

Cloudflare Email Routing manages incoming mail for `uier.io` through `infra/src/emailRouting.ts`.
The dashboard owns its three MX records and `cf2024-1._domainkey` TXT record. Pulumi retains the
existing root SPF resource and merges `include:_spf.mx.cloudflare.net` with the ACS-provided
`include:spf.protection.outlook.com`, preserving `-all`. Keep exactly one root SPF policy;
do not use the dashboard's conflicting-record deletion or create a second policy. See
[Cloudflare's domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/).

The program imports the existing routing settings, verified destination, all existing API-managed
rules (including disabled ones) and disabled catch-all before adding missing exact forwarding
rules for `contact@uier.io`, `security@uier.io` and `privacy@uier.io`. All are protected. Existing
rules retain their live name, priority, enabled flag, matchers and actions; conflicting requested
aliases stop the run rather than change an import. Worker-managed rules also stop adoption.

CI resolves the account ID with `getZone` using the existing `uier:zoneid`, then uses Cloudflare
invokes to discover verified destination IDs and rule IDs. Import IDs are `<zone_id>` for settings
and catch-all, `<account_id>/<destination_id>` for the destination, and `<zone_id>/<rule_id>` for
rules. The settings resource read preserves `supportSubaddress` (the settings invoke omits it in
our SDK). Rule detail invokes preserve writable inputs omitted by the list invoke. Listed catch-all
entries (an `all` matcher or the separately discovered catch-all ID) are excluded from detail
reads: Cloudflare serves them only through `rules/catch_all`. Discovery is
unfiltered for enabled status and refuses a possibly truncated result at 1,000 entries.

Exactly one verified destination is selected automatically. If the account has several, the
owner must set `uier:emailRoutingDestinationId` to the intended existing destination's ID. No
secret config key or plaintext destination address is needed. The destination email and rule
and catch-all actions are wrapped as Pulumi secrets, including resource outputs. Do not publish
unredacted Cloudflare responses, state or destination values in receipts.

Before merging, the owner must widen the two separate `CLOUDFLARE_API_TOKEN` environment
tokens. Preview stays read-only; production can create the missing rules. Required permissions:

| Token | Zone permissions on `uier.io` only (dashboard names) | Account permissions on the zone's DFNoise account only |
| --- | --- | --- |
| `preview` | DNS Read; Zone Read; Zone Settings Read; Email Routing Rules Read | Email Routing Addresses Read |
| `production` | DNS Edit; Zone Read; Zone Settings Read; Email Routing Rules Edit | Email Routing Addresses Read |

**Add the account as a token resource for both tokens.** A zone-only resource restriction does
not authorize `/accounts/.../email/routing/addresses`. Keep the zone restriction for zone
permissions; do not include other zones or accounts. Dashboard **Edit** maps to API **Write**.
The program only imports the existing verified destination and settings, so address/settings
write access is unnecessary. Keep **Zone Settings Read**; remove **Zone Settings Edit**.

Cloudflare API endpoint permissions checked against its documentation on 11 November 2026
(each read accepts either the listed Read permission or its Write counterpart):

| Endpoint used by discovery or resource refresh/import | Accepted API permission selected for preview / production |
| --- | --- |
| [`GET /zones/{zone_id}`](https://developers.cloudflare.com/api/resources/zones/methods/get/) (account discovery) | `Zone Read` / `Zone Read` (also accepts `DNS Read`, `DNS Write`, `Zone Settings Read` and other zone permissions) |
| [`GET /zones/{zone_id}/email/routing`](https://developers.cloudflare.com/api/resources/email_routing/methods/get/) (settings invoke and resource read) | `Zone Settings Read` / `Zone Settings Read` |
| [`GET /zones/{zone_id}/email/routing/rules`](https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/list/) and [`GET .../rules/{rule_id}`](https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/get/) | `Email Routing Rules Read` / `Email Routing Rules Write` |
| [`GET /zones/{zone_id}/email/routing/rules/catch_all`](https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/get/) | `Email Routing Rules Read` / `Email Routing Rules Write` |
| [`GET /accounts/{account_id}/email/routing/addresses?verified=true`](https://developers.cloudflare.com/api/resources/email_routing/subresources/addresses/methods/list/) and [`GET .../addresses/{destination_id}`](https://developers.cloudflare.com/api/resources/email_routing/subresources/addresses/methods/get/) | `Email Routing Addresses Read` / `Email Routing Addresses Read` |
| [`POST /zones/{zone_id}/email/routing/rules`](https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/create/) (missing aliases, production only) | No preview writes / `Email Routing Rules Write` |

Zone Read is explicit for account discovery; the existing DNS permission and required settings
read also authorize that endpoint. No account-wide Zone read or settings write is needed.
These are required scopes, not a credential rollout receipt. The current CI preview's 403 is
expected until the owner updates both tokens; do not bypass discovery or permissions to pass CI.

Review the PR's CI preview: adoption must show imports with no input changes, then at most three
new alias rules. Reject replacement, deletion, DNS changes or changes to any existing resource.
Do not run stack previews or updates locally. Import options remain safe on subsequent runs
for resources already in state; logical names for the three aliases stay stable after creation.
A later cleanup can remove completed imports only with a no-diff CI preview. After CI deploys,
verify the three rules and disabled catch-all, and deliver a real test message to each alias
before merging the site-address change in PR #627. Destination verification,
rule activation, authoritative DNS readback and an actual forwarded message are separate checks;
MX records alone do not establish successful delivery. The transactional `notify.uier.io` records
and sender identity are independent of inbound forwarding.

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

On 2 November 2026, inspection of an existing production digest confirmed SPF/DKIM/DMARC pass,
display name `uier`, both unsubscribe headers and report message-id correlation with its delivery
ledger. The [production digest receipt](review-notifications.md#production-digest-verification)
records the bounded evidence. ACS's DKIM signature does not cover either unsubscribe header;
mailbox providers may therefore omit one-click UI even though the POST endpoint works.

The separate matching change adds only production `UIER_EMAIL_REPORT_MATCH_OPERATIONS=1` through
Pulumi. Require its CI preview to show exactly one environment-variable creation and existing
resources unchanged, then confirm the production deployment and variable readback. Earlier
acknowledged reports are not replayed. Subscription provisioning alone is insufficient evidence
for any future sender or transport change.

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
export CLOUDFLARE_API_TOKEN=<production token with the zone and account scopes listed above>

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
| [`ci.yml`](../.github/workflows/ci.yml) | pull requests, manual | Web: parallel checks, API and browser jobs, plus a Vercel preview deployment (URL in the job summary). Extension: unit and packaged runtime checks. Infra: `pulumi preview` against `uier-production`, posted as a PR comment. `CI OK` aggregates all jobs. |
| [`deploy.yml`](../.github/workflows/deploy.yml) | push to `main`, manual | Builds the website alongside `pulumi up`, then deploys to Vercel production (`uier.io`) only after both succeed. |
| [`deploy-current_reusable.yml`](../.github/workflows/deploy-current_reusable.yml) | called | Checks for a newer eligible production workflow run, before building/applying and before uploading. |
| [`pulumi_reusable.yml`](../.github/workflows/pulumi_reusable.yml) | called | Installs and builds `infra/`, logs into Azure (OIDC) and runs `pulumi preview` / `up`. |
| [`vercel-build_reusable.yml`](../.github/workflows/vercel-build_reusable.yml) | called | Builds with public settings and no deployment credentials; uploads only the prebuilt output for this workflow run and attempt. |
| [`vercel-deploy_reusable.yml`](../.github/workflows/vercel-deploy_reusable.yml) | called | Validates and deploys this run's prebuilt output in an environment-bound job, without checking out the repository. |

- **`main`** is the only long-lived branch and is production. Pushes run `pulumi up` and a Vercel
  production deployment served on `uier.io`, unless all changed paths are excluded by `deploy.yml`.
- **Pull requests** target `main`. CI uses changed paths to run web checks and a Vercel preview for
  app/workspace changes, and `pulumi preview` for infrastructure changes. PRs from forks only run
  the checks that need no secrets. `CI OK` aggregates the required results, including skipped jobs.

The credential-free web build runs alongside infrastructure. The final upload requires both jobs to
succeed because the Vercel project settings (root directory, environment variables, domains) are managed
by Pulumi. Pull-request previews use the same build and upload workflows in sequence. Deployments are
made by the Vercel CLI from GitHub Actions; the Vercel project is not connected to Vercel's Git integration.

Concurrency: one production workflow runs at a time, with only the newest pending run retained;
`pulumi up` runs are serialized. A new push to a pull request cancels its previous CI run. Production
checks for a newer eligible `Deploy` run before building/applying and again before uploading. A
superseded run skips the remaining work and records its replacement in the job summary. These checks
need only Actions read access and execute without a checkout or deployment credentials. They use
workflow runs rather than main's HEAD, so a push excluded by `paths-ignore` does not suppress a needed
release. Re-running an older run also skips it when a newer eligible run exists; retry the newest run
to recover a failed release. A failed freshness lookup blocks release rather than assuming it is current.

An already running apply or upload finishes, even if another merge arrives. A newer merge after the
last check can therefore still result in two releases. The production workflow keeps its lock while
building so toolbar retention and search comparisons read the preceding completed release. Do not
move builds outside that lock without refreshing these production-dependent inputs before publishing.
This reduces wasted production uploads during merge bursts; it does not shorten the PR's required CI.

The web matrix separates typecheck/artifact/worker checks, all API tests, and all tagged desktop/mobile
browser essentials. Test jobs use four workers each and retain separate `playwright-results-api` and
`playwright-results-browser` artifacts. Matrix failures do not cancel sibling jobs; every result still
feeds `CI OK`. The required coverage and no-retry policy are unchanged.

Web, extension and Vercel builds cache only `apps/web/.next/cache`, using Next.js 16.3+'s persistent
Turbopack compiler cache. Keys include the OS, architecture, lockfile, Node version file and checked-out
revision, with a fallback to the same dependency set. Main's production build seeds the default-branch
cache for new PRs; PR caches stay scoped to their merge ref. Next invalidates compiler entries when
source or build configuration changes; each job still builds fresh output. Toolbar retention always
fetches the current production archive. Cache misses remain supported and take longer.

Prebuilt packaging deduplicates shared function dependencies and copies them in batches of 16,
retaining path and symlink validation. The archive uses gzip level 1 and disables redundant ZIP
compression during artifact upload. Only the credential-free build job caches its pinned Vercel CLI.
The deployment job continues to install its pinned CLI afresh;
neither repository executables nor a cached CLI enter the credential-bearing job.

Runners: jobs that only gate, aggregate or call an API (`Detect changes`, `CI OK`, the extension store
status and inspect jobs, and the extension `publish` job) run on `ubuntu-slim` (1 vCPU, 5 GB, 15-minute
limit, minimal tools). Anything that installs the workspace, builds, tests, packages or runs longer than
15 minutes stays on `ubuntu-latest`.

For runner comparisons, upload the same run-and-attempt artifact to preview in paired trials on both
runner types. Include Node setup, archive validation, fresh CLI installation and the upload in the job
duration. Record runner scheduling separately from time blocked by the production concurrency group;
changing runners does not remove that lock. Keep the credential boundary and fresh deployment CLI
installation in every trial.

The [9 November 2026 comparison](https://github.com/signalco-io/uier/actions/runs/42614490070)
used one preview artifact for three trials per runner. In the completed third pair,
`ubuntu-latest` took 46 seconds and `ubuntu-slim` took 81 seconds. The other slim uploads took
139 and 79 seconds; the regular latest preview took 49 seconds. Two latest trials ended with
Vercel CLI `fetch failed` transport errors after about five minutes and are excluded from the
successful-upload timing comparison. Across all three trials, median time before the upload
step was 21 seconds on latest and 49 seconds on slim. Keep the upload on `ubuntu-latest`:
the setup measurements favor it; these samples do not establish relative transport reliability.
The temporary benchmark matrix is not part of normal CI.

### Required GitHub configuration

Workflows resolve credentials from job environments. Reusable-workflow callers name each allowed
secret so GitHub makes the target environment value available. The repository copies were retired
after stage 3 validation; the Actions repository secret inventory is empty.
`production` allows only `main`; `preview` allows `main` and `refs/pull/*/merge`;
`production-worker` allows only `main`. All three have no reviewers or wait timer, following the
owner's unattended deployment policy. `AleksandarDev` remains administrator.

| Setting | `production` | `preview` | `production-worker` |
| --- | --- | --- | --- |
| `AZURE_CLIENT_ID` | uier GitHub Deployment | uier GitHub Preview | uier GitHub Worker |
| `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | uier tenant/subscription | Same identifiers | Same identifiers |
| `AZURE_STORAGE_ACCOUNT` | Pulumi state account | Same account, read scope | Absent |
| `VERCEL_TOKEN` | Separate uier-project token | Separate uier-project token | Absent |
| `CLOUDFLARE_API_TOKEN` | Zone: DNS Edit, Zone Read, Zone Settings Read, Email Routing Rules Edit on `uier.io`; account: Email Routing Addresses Read | Zone: DNS Read, Zone Read, Zone Settings Read, Email Routing Rules Read on `uier.io`; account: Email Routing Addresses Read | Absent |
| `UIER_INTEGRATION_ENV`, optional `ANTHROPIC_API_KEY` | Pulumi production variables | Absent | Absent |
| `UIER_WORKER_SETTINGS` | Absent | Absent | Allowlisted data/transport/crypto settings only |

The strict production integration map and rotations are described in
[connected service setup](integration-setup.md). The worker snapshot and refresh command are in
[review notifications](review-notifications.md). Neither build job references an environment or
secret. Builds use [public Vercel settings](../.github/vercel-project.json), matching the project,
root directory and Node version in Pulumi; the explicit install command supports the pinned pnpm
version without fetching project secrets. Only `.vercel/output` enters the build artifact, never a
pulled dotenv file. Next.js dependency-map sources are packaged inside that output too. The deploy
job validates archive paths, links and dependency references, reconstructs the fixed project
context, installs the pinned CLI with lifecycle scripts disabled and runs `--prebuilt` without a checkout.

OIDC uses issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`
and immutable owner/repository identifiers:

| Subject suffix after `repo:signalco-io@89613566/uier@1432139886:` | Identity |
| --- | --- |
| `environment:production` | uier GitHub Deployment (`988ad1db-b5be-4e47-8046-e76e7f19fc58`) |
| `environment:preview` | uier GitHub Preview (`5cefd38c-02e8-45fe-8367-f766ebfdf53e`) |
| `environment:production-worker` | uier GitHub Worker (`11a15260-e6c1-438a-95b3-aa51c8ec641c`) |

Production retains Contributor on `uier-production8b2f56d6`, Key Vault Crypto User on the
`pulumi-backend` key and Storage Blob Data Contributor on the `states` container. It has no restore
role. Preview's exact read/decrypt/key-read scopes are in the
[stage 2 receipt](ci-credential-rollout.md#stage-2-provisioning-receipt--2-november-2026).
The worker has only the data scopes documented above, with a separate subject so its OIDC token
cannot authenticate as the infrastructure identity.

Before a preview, `infra/scripts/preview-environment.mjs` exports encrypted state and sends only
existing production variable names/sensitivity to the program. Optional integration/Anthropic
resources remain registered with their previous values through preview-only `ignoreChanges`.
No production integration or Anthropic key is supplied as a preview environment secret. An update
rejects this metadata, so preview placeholders can never be applied. State decryption and the
transitional provider-key reads still expose production credentials; this stage does not establish
full production-data isolation. Production Cosmos runtime key access was removed in stage 4;
account-key disabling/rotation and removal of historical state exposure belong to stage 5.

Stage 3 removed the old repository secrets and deployment app's main/PR subjects after successful
replacement runs, including the main-only email verification workflow. Readbacks are recorded in the
[credential rollout](ci-credential-rollout.md#stage-3-separate-builds-and-remove-the-worker-environment-pull).

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

## Security disclosure discovery

[`/.well-known/security.txt`](https://uier.io/.well-known/security.txt) is a static UTF-8 text
file in `apps/web/public/.well-known/`, following [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116.html).
It publishes the existing `security@signalco.io` reporting contact and links to the repository's
[security policy](../SECURITY.md). `/security.txt` permanently redirects to the canonical path.

Review the contact and policy when renewing the fixed `Expires` date, keeping the new expiry
less than one year ahead. Requests and builds do not extend it automatically. The HTTP check in
`e2e/seo.api.spec.ts` fails when the file expires, and checks the UTF-8 plain-text response and
legacy redirect. After deployment, fetch the canonical URL without authentication and verify
the content type, reporting fields and expiry; keep the document out of the HTML sitemap.

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

## Pinned toolbar bundles

The Vercel reusable build sets `UIER_TOOLBAR_RETAIN_FROM=https://uier.io` and `TURBO_FORCE=true`
so cached task outputs cannot restore an older archive. Before publishing, the
web build reads the previous no-store `/toolbar/manifest.json`, downloads supported bundles with
bounded concurrency/size/time, and verifies their content-addressed SHA-256 paths. A missing
manifest (404) bootstraps the first release. Other failures stop deployment; do not bypass them
by clearing the archive source. The manifest records when each hash was last the current version.
The archive contains both loaders and their review scripts. Each loader embeds its review script's
content-addressed URL and integrity value; retain both together.
Each bundle is limited to 1,000,000 uncompressed bytes, checked both before publishing new assets
and while downloading retained assets, so a new release cannot exceed its own retention limit.
Keep each production bundle and its review API contract working for one year after that date;
breaking API changes must retain the old contract through the supported window. Sites update
their pinned snippet to receive fixes. Previews/local pins carry no production retention promise.

For a rollback, rebuild the chosen revision with the current production archive and force the
build tasks (`UIER_TOOLBAR_RETAIN_FROM=https://uier.io pnpm exec turbo run build --force`). Promoting an old
deployment without rebuilding can remove pins released since that deployment. Before promotion,
check that its `/toolbar/manifest.json` contains every still-supported production hash. If the live
archive is unavailable, recover its manifest and verified files from the last deployment before
rebuilding; do not publish a fresh empty archive. The build artifacts are gitignored and included
in Turborepo outputs; no credentials or customer content are stored with bundles.

## Azure deletion locks

On 2 November 2026, the owner added Azure `CanNotDelete` locks
`uier-production-cannot-delete` on resource group `uier-production8b2f56d6` and
`uier-cosmos-cannot-delete` on Cosmos account `uierdbaba6cd56` in that group. The
[stage 5 receipt](ci-credential-rollout.md#owner-managed-azure-deletion-locks) records exact scopes
and live readback. They protect management resources and inherited children from deletion, while
allowing in-place updates; item/blob deletion still follows data-plane permissions and retention.
CI has no lock-management role. Exceptional resource deletion or role revocation needs a
separately authorized owner operation to remove applicable locks and restore them after readback.
Standard deployments remain unattended and do not remove locks or Pulumi protection.

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
   or MCP connection. Changes take effect when the new deployment is live. The next app request
   and each instance's first provisioning call reconcile stored memberships as well.

Addresses are trimmed, lowercased and checked with `emailSchema`; malformed entries are skipped.
A missing or empty runtime variable means no staff. Public pages, sign-in and personal workspaces
still work. Previews receive no production staff list. Intentionally removing all staff requires
an explicit empty secret value and leaves moderation unavailable until a staff list is deployed.

**Cosmos DB fallback:** use Data Explorer only when the app procedure is unavailable.

1. Sign in to Azure Data Explorer using **Microsoft Entra ID** in the uier tenant, never a key
   or connection string. The standing fallback operator is **AleksandarDev** (Azure user object
   `33e65245-6fe9-419f-86da-74b8a2fd5cba`), with Cosmos Built-in Data Contributor scoped separately
   to `comments` and `comments-preview`. `app` is Data Reader only. These roles are separate from
   Azure management Owner; review/revoke them when the operator changes. For SDK tooling, use
   `AzureCliCredential` with the live account endpoint. Open database `uierdata`, container
   `comments` (`comments-preview` for previews).
2. Query the exact public project partition and thread id:

   ```sql
   SELECT * FROM c WHERE c.domain = 'project:uier00000001' AND IS_DEFINED(c.path)
     AND c.id = '<comment id>'
   ```

   Guests' feedback is in `project:uier00000001`, signed-in accounts' in `project:uier00000002` (threads
   accounts started before the split moved there with the same id). Threads posted before the public-project
   migration may also have an original copy under `uier.io`. Confirm the partition and document id
   before any write.
3. Delete only that comment and its `$screenshot_<comment id>` document in the same partition.
   To remove one reply, remove its entry from `thread.items` and update the comment. If that leaves
   only a deleted first-item placeholder, delete the thread and screenshot instead.
   Never delete `$sequence_comments` or rate-limit counter documents. Refresh the app/API to
   confirm the thread or reply is gone, its screenshot returns not found when the thread went,
   and the next comment continues numbering. The API does not cache these reads.
4. For a thread posted before the migration, query the same comment id in the `uier.io` partition.
   Delete that legacy comment and its `$screenshot_<comment id>` document too, if present. Do this
   for both moderation and deletion/erasure requests; do not wait for the copies' 90-day expiry
   after their last change. When removing one reply through Data Explorer, remove it from the
   legacy copy too. App thread deletion already cleans up legacy copies and queues a retry if
   cleanup fails; direct Data Explorer edits bypass that cleanup.

For an accidental operator delete, follow [Backups and restore](backups-and-restore.md#backups-and-restore). Never recover
abuse, an author's deletion or content covered by an erasure request.

## MCP request logs

Every coding tool request to `/api/mcp` writes one `mcp_request` JSON event to the hosting logs:
the tool, prompt or resource, the outcome and error codes, rejected argument fields, result sizes,
the client's name and keyed connection references. Unexpected failures are logged at error level
with the error class and code locations, never the message. [Request logs](mcp.md#request-logs)
describes every field and what is never logged. Filter on `"event":"mcp_request"` and export before
the hosting retention expires; no log drain is provisioned.

To decide what to improve, summarize an NDJSON export (raw events or Vercel JSON log objects) for one
UTC day and environment:

```bash
pnpm -C apps/web exec node scripts/mcp-report.mjs /absolute/path/mcp-logs.ndjson 2026-11-04 production
```

The JSON report counts requests and calls by outcome and error, per tool, prompt and resource, with
validation issues, missing scopes, answer sizes, names and arguments clients expected, client
versions, distinct connections and unexpected failure classes. It prints no raw log lines, ids or
references. [Daily report](mcp.md#daily-report) describes each field.

## Rewrite usage and costs

[Rewrite accounting and evaluation](rewrite-costs.md) documents the `rewrite_usage` server-log event,
UTC daily report command, missing usage and retry/fallback coverage, price maintenance and provider
reconciliation. Use the existing hosting log export before its retention expires; no paid log drain or
observability upgrade is required. Keep provider invoice/Cost Report totals separate from application
estimates. The current evidence gap and unchanged Opus model decision are recorded there; no real-model
comparison or Anthropic charges have been measured in this implementation session.
