# CI credentials and production database authentication

Staged implementation of [#167](https://github.com/signalco-io/uier/issues/167). Each stage lands
through a pull request and CI deployment. Never run `pulumi up` locally, remove resource protection,
or remove an old credential before its replacement has passed live verification.

## Preparation in this change

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
still has `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_STORAGE_ACCOUNT`,
`VERCEL_TOKEN` and `CLOUDFLARE_API_TOKEN` as repository secrets. This change does not move or
revoke them. GitHub cannot return existing secret values; their owner must provision replacements
or securely re-enter them in the target environment before the workflow switch.

The main ruleset requires `CI OK` and a pull request, with zero required approving reviews.
Azure management locks were not established by preparation. The provisioning receipt below records
the later environment and preview-identity setup; production still uses its account key.

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
Provisioning is complete; activation and a real OIDC/Pulumi preview are still unverified.

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

Existing repository secrets remain for the current workflows. Do not remove them until their
replacement environment-based callers have succeeded, including notifications and email verification.

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

### Activation gates still outstanding

Existing workflows continue to use repository secrets and the previous identity. No run has yet
proved the new environment OIDC subjects, preview state access/decryption or a complete Pulumi
preview under the separate identity. Before switching those callers, preserve optional production
variable registration without supplying production integration/Anthropic credentials to previews,
run an infra test PR, inspect its plan and verify provider compatibility with project-scoped Vercel
tokens. A successful token creation or role audit does not establish these runtime checks.

## Stage 3: separate builds and remove the worker environment pull

The stage 3 workflows use environment secrets directly: `production` for Pulumi updates and
production uploads, `preview` for infrastructure previews and preview uploads. Caller workflows
forward no credentials. Neither environment requires a reviewer or wait timer. The email-domain
verification job uses `production` too. The Azure login is checked against the expected app client
identifier in every credential-bearing Azure job.

Before a preview, the CLI exports encrypted state. Only the 45 existing production environment
variable names, logical resource names and sensitivity flags enter `UIER_PREVIEW_ENV_METADATA`.
Optional integration credentials, rotation values and Anthropic settings remain registered with
preview-only value preservation; their real values are neither passed as environment secrets nor
replaced by placeholders during updates. Updates reject preview metadata. A live preview must still
show no unexpected changes to existing data, domains, backups, keys or production variables.

### Build and deployment boundary

The Vercel build job has no environment or deployment token. It uses checked-in public project
settings, the pinned CLI and the existing build commands. A credential-free local production build
with a fresh CLI config directory succeeded before rollout. Only `.vercel/output` is archived;
no dotenv file or pulled project environment is uploaded. The production and preview build outputs
retain the existing toolbar archive behavior.

A separate deploy job has no checkout. It validates archive paths, entry types and symbolic links,
rejects environment files, reconstructs the fixed uier team/project context and installs the pinned
CLI with lifecycle scripts disabled. It executes only `vercel deploy --prebuilt --archive=tgz`.
Unit tests exercise traversal, credential-file and escaping-link rejection. The actual local output
archive also passed the same extractor, with 806 paths and no environment files.

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

At implementation time, local typecheck/build, the credential-free Vercel build, infrastructure
helper tests, archive-boundary tests, workflow lint and live metadata parsing have passed. A PR run
under the new preview identity, a main deployment under the production subject, a worker OIDC
verification run and the migrated email-domain workflow still need their live results recorded here.
Do not infer those results from provisioning or local tests.

Retain repository secrets and all four old main/PR federated subjects until those replacement
callers succeed. Then remove the unused repository credentials and old subjects, verify the remaining
secret/subject inventories and repeat manual-main CI. Production application Cosmos/Blob key
retirement remains in the later stages; preview state/key reads and Vercel's project-wide token
scope still carry production-sensitive access.

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
