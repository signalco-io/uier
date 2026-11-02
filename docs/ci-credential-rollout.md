# CI credentials and production database authentication

Staged implementation of [#167](https://github.com/signalco-io/uier/issues/167). Each stage lands
through a pull request and CI deployment. Never run `pulumi up` locally, remove resource protection,
or remove an old credential before its replacement has passed live verification.

## Stage 1: preparation

- Every external workflow action is pinned to its resolved 40-character commit, with the original
  version in a comment. Renovate extends `helpers:pinGitHubActionDigests` and does not automerge
  action updates.
- Automatic dependency merges are off by default. Only `devDependencies` matching `@types/*`,
  `@playwright/test` and `@axe-core/playwright` may automerge minor/patch/pin/digest updates after
  three days. Runtime packages, build tools, package managers, Vercel and Pulumi need maintainer merges.
- The public security page accurately describes the lack of a required approving review and the
  fact that data-resource deletion protection applies to Pulumi changes.
- CI will create `uier-production-cosmos`, its Vercel production federation and two container-scoped
  Cosmos DB Built-in Data Contributor assignments. The identity and assignments are protected.
  The production Vercel variables, account keys and authentication flags stay as they are.
- The connection-string environment resource gains `deleteBeforeReplace` before any later
  sensitivity or key change. This resource option alone must not replace or change the variable.
- Vercel CLI installation skips lifecycle scripts. The notification job masks pulled dotenv values
  before later steps and the runner repeats masking before loading an explicitly supplied file.

The preparation preview must show **four creations only**: the identity, federation and two role
assignments. Existing database/account settings, backups, domains, email resources, keys, Vercel
environment values and preview permissions must have no changes. Inspect the CI preview before
enabling auto-merge. A successful merge does not establish deployment or live authentication.

## Initial external prerequisites

Read-only preflight on 29 October 2026 found no GitHub deployment environments. The repository
then held `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_STORAGE_ACCOUNT`,
`VERCEL_TOKEN` and `CLOUDFLARE_API_TOKEN` as repository secrets. Preparation retained them. Stage 2 provisioned replacements and
stage 3 activated those replacements and removed the repository copies. GitHub cannot return an
existing secret value; replacements must be provisioned before switching workflows.

The main ruleset requires `CI OK` and a pull request, with zero required approving reviews.
Azure management locks were not established by preparation. The provisioning receipt below records
the later environment and preview-identity setup. Production runtime identity activation is recorded
in stage 4 below; account-key authentication remains enabled until stage 5.

## Stage 2: prepare the deployment boundaries

1. Create the GitHub **production** environment with a deployment branch policy allowing only
   `main` (no tag patterns). Store the write-capable Azure identity identifiers, backend identifier,
   `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, optional `ANTHROPIC_API_KEY` and optional integration
   credential settings there. Verify each value is present before deleting its repository copy.
2. Add the write app's federated credential for issuer `https://token.actions.githubusercontent.com`,
   audience `api://AzureADTokenExchange` and subject
   `repo:signalco-io@89613566/uier@1432139886:environment:production`. Keep both old subjects
   until all their callers have migrated, including the main-only email verification workflow.
3. Create a **preview** environment allowing pull-request merge refs and manual CI on `main`,
   with no tag patterns. On 2 November 2026 the owner chose unattended preview and production
   deployments, replacing #167's original required-reviewer criterion. Neither environment has
   reviewers or a wait timer. `AleksandarDev` remains the repository administrator for intervention.
   Forks keep credential-free checks.
4. Provision a separate Entra preview app with its own environment subject. Start with Reader on
   the uier resource group. Give it only the backend blob access needed for state/preview locking,
   Key Vault cryptographic access needed to decrypt config, and narrowly scoped key reads still
   required by the program. Test the actual preview, then inspect direct and inherited roles to
   prove there is no Azure resource-write role. Do not copy the deployment app's Contributor role.
5. Supply separate provider preview credentials, with DNS read on `uier.io` for Cloudflare and
   the least Vercel project/team permissions available. Give previews no Anthropic key or production
   integration credentials. Before activating the new preview identity, refactor optional production
   variable registration so omitted preview secrets cannot plan a deletion. State decryption and
   provider key reads expose production credentials even without a resource-management write role;
   unattended previews must account for that access rather than claim production-data isolation.

## Stage 2 provisioning receipt — 2 November 2026

GitHub and Azure were configured directly for the CI identities; no Pulumi update, database setting,
application variable, existing credential revocation or workflow authentication change was made.
At this handoff, provisioning was complete and runtime activation remained unverified.
The stage 3 receipt below records the completed activation.

### GitHub environments

| Environment | ID | Allowed refs | Approval |
| --- | --- | --- | --- |
| `production` | `25968220462` | Branch `main` only | None |
| `preview` | `25968222228` | Branch `main` and `refs/pull/*/merge` | None |

Readback confirmed custom branch policies, no tag policies, no required reviewers and no wait timer.
`AleksandarDev` retains repository admin access; no administrator role was added or removed.

Both environments contain `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`AZURE_STORAGE_ACCOUNT`, `VERCEL_TOKEN` and `CLOUDFLARE_API_TOKEN`. Production additionally contains
`UIER_COMMENTS_SECRET` and `UIER_INTEGRATION_ENV`; neither is present in preview. The production
integration map was reconstructed from the 20 deployed optional provider/sign-in inputs in Pulumi
state, preserving multiline values. Generated integration encryption keys retain their existing
Pulumi resources rather than becoming overrides. No Anthropic variable was deployed or repository
secret present, so no Anthropic secret was added. Secret values were not printed or committed.

Repository secrets were retained through stage 2. Stage 3 removed them after replacement
environment-based callers succeeded, including notifications and email verification.

### Azure federation and access

Tenant: `c7837eb3-77ca-413b-8653-c97b08886678`; subscription: `d22db5bd-ca9a-447c-9b1b-dc56aca401d7`.

The existing **uier GitHub Deployment** app (`988ad1db-b5be-4e47-8046-e76e7f19fc58`) now also trusts
`repo:signalco-io@89613566/uier@1432139886:environment:production`. All four existing main/PR
federated credentials, including the two legacy name-based subjects, remain during migration.

The separate **uier GitHub Preview** app has:

- Application/client ID: `5cefd38c-02e8-45fe-8367-f766ebfdf53e`.
- Application object ID: `8f3fdedd-40fe-4968-a4e1-075180fdb4c5`.
- Service principal ID: `10cbb5ec-b987-417e-8da0-2de15d8f541d`.
- Exactly one federated subject: `repo:signalco-io@89613566/uier@1432139886:environment:preview`,
  issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`.
- No client passwords, certificates, requested API permissions or transitive group memberships.

Direct and inherited Azure role readback found only these six assignments:

| Role | Scope | Permissions |
| --- | --- | --- |
| Reader | Resource group `uier-production8b2f56d6` | Resource reads |
| `uier CI preview state reader` | `sastate2a61d506/blobServices/default/containers/states` | Container and blob reads only |
| `uier CI preview state decryptor` | `vault-pulumib5f713d9/keys/pulumi-backend` | Key metadata and decrypt only |
| `uier CI preview provider key reader` | Cosmos account `uierdbaba6cd56` | Connection-string read |
| `uier CI preview provider key reader` | ACS `uier-communication-servicecae001c6` | Service-key read |
| `uier CI preview provider key reader` | Storage account `uierimages95586b273e` | Storage-key read |

The custom role definition IDs are `c65b9739-5d44-4bf6-b13b-eea56857aaec` (state reader),
`d3c965d2-d575-4002-b99e-0a16417f3b5f` (state decryptor) and
`a80b3395-ede8-4768-8be9-edd2b9daa8cf` (provider key reader). The last definition contains only
`Microsoft.DocumentDB/databaseAccounts/listConnectionStrings/action`,
`Microsoft.Communication/CommunicationServices/ListKeys/action` and
`Microsoft.Storage/storageAccounts/listKeys/action`, and is assigned separately at those three
resources. None grants resource writes, deletes, role assignment, key rotation, key updates or
state writes. State locking permissions have not been broadened speculatively; test an actual preview
and add only a demonstrated missing permission if needed.

These are infrastructure-preview permissions, distinct from the application's Vercel preview Cosmos
identity. The ability to retrieve existing data keys still permits data access through those keys.

### Provider credentials

Separate `github-uier-production-2026-11` and `github-uier-preview-2026-11` Vercel tokens were created
with `projectId=prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc`, within the signalco team. Each token successfully
read the uier project before being saved directly to its environment. They expire on 2 November 2027
(Europe/Zagreb). The token creation API exposes project scoping, without a read-only or
preview-environment-only permission option: the preview token must still be treated as sensitive
to the whole uier project. It is distinct from production's token and has no team-wide project scope.

Cloudflare has matching, separate token names, both limited to the `uier.io` zone in DFNoise and
expiring on 2 November 2027. Preview has **DNS Read**; production has **DNS Edit**. The reviewed
creation summaries and token-list readback confirmed their scopes and Active status. Values were
copied directly into the corresponding encrypted GitHub environment secrets and removed from the
clipboard afterwards. GitHub's API confirmed both secret names were present.

### Stage 2 handoff

Activation required an actual preview under the new subject, read-only state/key permissions,
provider compatibility with project-scoped Vercel tokens and optional production variable preservation.
The stage 3 receipt records those checks and migration of the main deployment, worker and email job.

## Stage 3: separate builds and remove the worker environment pull

The stage 3 workflows use environment secrets directly: `production` for Pulumi updates and
production uploads, `preview` for infrastructure previews and preview uploads. Caller workflows
name each allowed secret, as required by GitHub; the target job environment supplies
the values. Repository copies are retired after validation. Neither environment requires a reviewer or wait timer. The email-domain
verification job uses `production` too. The Azure login is checked against the expected app client
identifier in every credential-bearing Azure job.

Before a preview, the CLI exports encrypted state. Only the 45 existing production environment
variable names, logical resource names and sensitivity flags enter `UIER_PREVIEW_ENV_METADATA`.
Optional integration credentials, rotation values and Anthropic settings remain registered with
preview-only value preservation; their real values are neither passed as environment secrets nor
replaced by placeholders during updates. Updates reject preview metadata. A live preview must still
show no unexpected changes to existing data, domains, backups, keys or production variables.

The provider-level Vercel `team` setting is removed: it performs a team-wide metadata read that
project-scoped tokens cannot make. Every managed Vercel resource supplies the fixed team ID instead.
This keeps both new tokens scoped to uier.

### Build and deployment boundary

The Vercel build job has no environment or deployment token. It uses checked-in public project
settings, the pinned CLI and the existing build commands. A credential-free local production build
with a fresh CLI config directory succeeded before rollout. Only `.vercel/output` is archived;
no dotenv file or pulled project environment is uploaded. The production and preview build outputs
retain the existing toolbar archive behavior.

A separate deploy job has no checkout. It validates archive paths, entry types and symbolic links,
rejects environment files, reconstructs the fixed uier team/project context and installs the pinned
CLI with lifecycle scripts disabled. It executes only `vercel deploy --prebuilt --archive=tgz`.
Unit tests exercise traversal, credential-file and escaping-link rejection. The build also packages Next.js `filePathMap` dependencies inside `.vercel/output/runtime-files`
and rewrites their source references. The upload extractor rejects any dependency reference outside
that packaged directory, as well as missing or environment-file references. Tests check that the
package works after removing its source dependencies and refuses runner-file references.

### Scheduled worker boundary

The GitHub five-minute schedule is retained. `notifications.yml` builds a standalone worker and its
traced dependencies without credentials. A separate **production-worker** environment allows only
`main`, with no reviewers, wait timer or tags. Its Azure subject is
`repo:signalco-io@89613566/uier@1432139886:environment:production-worker`, deliberately distinct
from the deployment app's subject.

**uier GitHub Worker** identifiers:

- Application/client ID: `11a15260-e6c1-438a-95b3-aa51c8ec641c`.
- Application object ID: `808208cd-40c6-429d-bba3-7606e886e0e3`.
- Service principal ID: `6a1b5b2f-081c-48ea-af8f-4aaf3d4deb30`.

Its only Azure RBAC assignments are the custom `uier worker screenshot data` role on `screenshots`
and `screenshots-preview`; it grants container reads and blob read/write/delete only, without
container write/delete or delegation keys. The role definition is `dffe52dd-c4d2-4d41-8a42-410ca1ae7e1c`.
Its Cosmos data-plane assignments are Built-in Data Contributor on
`comments`, `app` and `comments-preview`. These support the existing production delivery,
integration, deletion and preview-image cleanup passes. It has no state, Key Vault, resource-write,
provider-key-read or `app-preview` access and has no client password or certificate.

The worker environment contains only its Azure client/tenant/subscription identifiers and
`UIER_WORKER_SETTINGS`, initially 31 allowlisted deployed values: data endpoints, existing comment
signing secret, email transport settings and required integration credentials/encryption keys.
There is no Vercel token, account key, provider deployment token, Anthropic key, sign-in-only
credential or environment download. Every setting is masked before loading. The worker uses the
Azure CLI credential established by its OIDC login instead of a Vercel request token.

The packaged worker was loaded from an isolated temporary directory to verify its dependency
closure and context guard. Every production run validates missing-document/Blob metadata reads
before writes. Manual `verify_only=true` stops after those checks without email, integration work,
migration or cleanup. See [worker settings and rotation](review-notifications.md) for the strict
snapshot refresh command; refresh it after provider/mail/key changes before retiring old keys.

### Activation and retirement evidence

[PR #287](https://github.com/signalco-io/uier/pull/287) activated stage 3 at commit
`3eefe4afb338d5f7e124faf883871259168e6206` on 2 November 2026. Local typecheck/build and the
default suite passed (551 tests, one skipped), along with 28 infrastructure helpers, archive and
function-map boundary tests, an isolated worker dependency check and workflow lint. The pinned
Vercel CLI also built with an empty authentication config; its complete standalone archive passed
the same extraction and dependency-reference checks used by the upload job.

| Live check | Evidence | Result |
| --- | --- | --- |
| Real PR preview | [CI #41366760794](https://github.com/signalco-io/uier/actions/runs/41366760794) | Preview subject/client verified; encrypted state read and decrypted; 45 production variable registrations preserved; 105 resources unchanged |
| Preview upload and runtime | [Protected preview](https://uier-ncln8tnk4-signalco.vercel.app/api/status) | Separate credential-free build/upload jobs passed; authenticated health check returned operational website/comments with a live Cosmos read |
| Main production deployment | [Deploy #41367229311](https://github.com/signalco-io/uier/actions/runs/41367229311) | Production subject/client verified; 105 resources unchanged; prebuilt production upload ready and aliased to uier.io |
| Worker OIDC | [Verification #41367230414](https://github.com/signalco-io/uier/actions/runs/41367230414) | Dedicated production-worker subject/client verified; all three Cosmos containers and both Blob containers readable; verify-only mode performed no writes or delivery |
| Email-domain workflow | [Verification #41367233151](https://github.com/signalco-io/uier/actions/runs/41367233151) | Production subject/client verified; Domain/SPF/DKIM/DKIM2 Verified; authoritative DMARC rejection policy verified |

Public production `/api/status` returned HTTP 200 with both services operational, and `/app/sign-in`
returned HTTP 200. Vercel readback confirmed uier.io points to ready deployment
`dpl_ErxJzcxFUMc6ECUTUjyVGtvCgrKa` (`uier-a1k4jgwx7-signalco.vercel.app`) after retirement.

After those replacements succeeded, the repository Actions secret inventory was emptied:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_STORAGE_ACCOUNT`,
`VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `UIER_COMMENTS_SECRET` and `UIER_INTEGRATION_ENV`
were removed. The unused production-environment comment-secret copy was also removed; deployed
application values and the worker settings snapshot retain the existing signing secret.

All four legacy main/PR federated credentials were removed from the deployment app:
`github-uier-main`, `github-uier-pull-request`, `github-uier-main-immutable` and
`github-uier-pull-request-immutable`. Readback confirms each of deployment, preview and worker
apps now has exactly one GitHub environment subject. Environment inventories contain seven
production, six preview and four worker secrets. Branch-policy readback still allows only main
for production/worker and main plus PR merge refs for preview, with no reviewers, wait timers or
tag policies. `AleksandarDev` retains repository ADMIN permission.

Post-retirement checks also passed with zero repository Actions secrets:

- [Manual-main CI #41367710026](https://github.com/signalco-io/uier/actions/runs/41367710026): CI OK,
  582 default tests passed and one skipped, separate preview deployment succeeded, preview OIDC
  subject verified and 105 infrastructure resources unchanged.
- [Production deploy #41367719405](https://github.com/signalco-io/uier/actions/runs/41367719405):
  production OIDC subject verified, 105 resources unchanged and the standalone prebuilt upload ready.
  Public health remained HTTP 200 with both services operational.
- [Worker verification #41367712817](https://github.com/signalco-io/uier/actions/runs/41367712817):
  dedicated worker OIDC subject and all five data scopes verified again, without writes or delivery.

At the stage 3 handoff, Cosmos readback matched the pre-activation baseline: Continuous7Days backup,
no migration in progress, `disableLocalAuth: false`, `disableKeyBasedMetadataWriteAccess: false` and provisioning
Succeeded. Production application Cosmos/Blob keys were retained at that handoff for the later stages. Preview
state/key reads and Vercel's project-wide token scope still carry production-sensitive access.
No local Pulumi update or protected-resource deletion/replacement was performed. Stage 4 below
records the production identity cutover; #167 stays open for the remaining operator/restore and key-retirement checks.

## Stage 4: switch production to the prepared Cosmos identity

After preparation deploys, read back the production identity, its issuer/audience/subject and both
role scopes. Add production `COSMOSDB_ENDPOINT`, `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` using that
identity and remove `COSMOSDB_CONNECTION_STRING` in the same CI stage. The app rejects simultaneous
endpoint and connection-string settings. Preserve both container names and all application secrets.
Remove the account connection-string lookup only when the worker no longer consumes it.

Deploy through CI, verify authenticated app data and comments on production, verify preview isolation,
and deliver a recipient-authorized digest. Record the commit, CI/deployment URLs, live identity and
role readback, worker result and application checks. Do not infer delivery from a successful build.
Keep account-key authentication enabled until these checks pass.

### Stage 4 implementation and readback

The program removes `listDatabaseAccountConnectionStringsOutput` and the production connection-string
variable, and adds three production-only identity variables. It retains both container names, comment
signing keys, screenshot credentials, email/integration settings and the worker settings snapshot.
The new variables depend on the already-protected federation and both data assignments. The exact
CI plan must show three Vercel variable creations and one variable deletion, with no identity,
permission, database, container, backup, domain, key or other application-variable changes.

Preflight on 2 November 2026 confirmed the prepared identity `uier-production-cosmos8aa0f6cc`:
client `337dc73c-b36c-4425-8b70-99b4f8811b28`, principal
`71c0cea5-d909-495a-a82b-53b0b97bc7e3`, tenant `c7837eb3-77ca-413b-8653-c97b08886678`.
Its only federation is issuer `https://oidc.vercel.com/signalco`, audience
`https://vercel.com/signalco` and subject `owner:signalco:project:uier:environment:production`.
Its only Cosmos assignments are Built-in Data Contributor on `comments` and `app` in `uierdata`;
Azure management-role readback was empty. Both account authentication flags remain false,
Continuous7Days backup has no migration in progress and account provisioning is Succeeded.

### Stage 4 activation receipt — 2 November 2026

[PR #332](https://github.com/signalco-io/uier/pull/332), commit
`08ada597a8bf271e03da566a3de0e0be026f52bb`, activated the production Cosmos identity through CI.
Local typecheck/build, 28 infrastructure tests and the default suite passed (585 tests, one skipped).
Two launch tests initially timed out; both passed serially on a fresh port, followed by the full
passing default suite. No toolbar source was edited.

| Check | Evidence | Result |
| --- | --- | --- |
| PR plan and required checks | [CI #41370158581](https://github.com/signalco-io/uier/actions/runs/41370158581) | All checks passed; exactly three production Vercel variables to create, one connection-string variable to delete, 104 resources unchanged |
| Production apply and deployment | [Deploy #41370612470](https://github.com/signalco-io/uier/actions/runs/41370612470) | Applied exactly that plan; prebuilt production deployment READY |
| Production runtime | [Cutover deployment](https://uier-iz3p5pjxz-signalco.vercel.app) | Deployment `dpl_9DCGaNiP2MKiEm8skHmkAJLMbkbL` was confirmed behind uier.io; public `/api/status` returned HTTP 200 with website/comments operational |
| Authenticated app and comments | Existing signed-in Edge session, freshly reloaded after deployment | Account, workspace access and project data loaded; the existing project retained 14 comments, 9 open and 5 done |
| Worker data access | [Verify-only #41371286951](https://github.com/signalco-io/uier/actions/runs/41371286951) | Dedicated worker OIDC subject and all three Cosmos/two Blob data scopes verified; no writes or delivery |
| Preview after permission retirement | [Manual-main CI #41371513433](https://github.com/signalco-io/uier/actions/runs/41371513433) | Separate preview OIDC subject verified; 107 infrastructure resources unchanged without the Cosmos key-read assignment |

Vercel API readback verified all three production identifier/endpoint values against the prepared
identity and live Azure endpoint. `COSMOSDB_CONNECTION_STRING` was absent. The other 51 Vercel
variable IDs, targets, types and branch metadata were retained, including the unchanged preview
variables, signing secrets and screenshot credentials. The production/preview identities and both
container selections remain separate. The successful production comments and authenticated app reads
therefore ran through the configured endpoint identity, without a connection-string fallback.

After activation and these checks, the preview CI app's unused Cosmos-account key-read assignment
`55ea0868-bad2-5a85-b028-ba6bba5224e6` was removed. Its remaining five Azure RBAC assignments are
resource-group Reader, state-container read, state-key decrypt, ACS key read and screenshot-account
key read. The follow-up preview succeeded after that removal. Historical state can still expose the
old account key; removing a fresh key-read assignment does not establish full data isolation.

The full follow-up CI passed: 609 web/API tests passed, one skipped, the preview deployed and
[its authenticated health check](https://uier-4nd029kp3-signalco.vercel.app/api/status) returned both
services operational. The extension browser fixture initially timed out waiting for its comment
textbox; the single targeted job rerun passed without source changes. The cutover PR's required
checks had already passed before merge.

Azure account readback exactly matches the pre-cutover baseline: `disableLocalAuth: false` and
`disableKeyBasedMetadataWriteAccess: false`, Continuous7Days backup has no migration in progress
and provisioning is Succeeded. No local
Pulumi update, database/container change, account-key rotation, protection removal or deployment
approval gate was introduced. The worker snapshot and existing screenshot-storage key were retained.
No test digest was generated; worker verification proves data access, not outbound delivery.
Stage 5 still requires the named operator/restore prerequisites, key disabling/rotation and the final
application/delivery checks before #167 can close.

## Stage 5: retire key access and verify the boundaries

Give moderation/Data Explorer operators and the restore operator appropriate Entra data-plane
access first; update [moderation](operations.md#removing-abusive-comments) and the
[restore runbook](backups-and-restore.md). In a later CI stage set both `disableLocalAuth: true` and
`disableKeyBasedMetadataWriteAccess: true`. Read back the flags, regenerate both account keys through
an authorized controlled operation, then repeat production app/comment and digest checks.

An owner separately adds Azure `CanNotDelete` locks on the resource group and `uierdb` and records
their exact scopes and live readback. Contributor cannot manage these locks. Until then, the public
control continues to describe Pulumi-only protection. Keep the main ruleset/review wording accurate.

Final acceptance also needs a real infra pull request running without an approval wait under the
owner's unattended policy, a successful preview under the separate identity, evidence of its
effective roles, and a main push that successfully runs
both `pulumi up` and the production deploy. Keep #167 open until all live gates are recorded.

References: [GitHub secure workflow use](https://docs.github.com/en/actions/reference/security/secure-use),
[Cosmos DB data-plane RBAC](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control),
[Renovate action digest pins](https://docs.renovatebot.com/presets-helpers/#helperspingithubactiondigests).
