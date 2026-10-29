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

## Current external prerequisites

Read-only preflight on 29 October 2026 found no GitHub deployment environments. The repository
still has `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_STORAGE_ACCOUNT`,
`VERCEL_TOKEN` and `CLOUDFLARE_API_TOKEN` as repository secrets. This change does not move or
revoke them. GitHub cannot return existing secret values; their owner must provision replacements
or securely re-enter them in the target environment before the workflow switch.

The main ruleset requires `CI OK` and a pull request, with zero required approving reviews.
Azure management locks have not been established by this change. Do not claim that environment
isolation, a read-only preview identity, keyless production access or Azure deletion locks are active.

## Stage 2: prepare the deployment boundaries

1. Create the GitHub **production** environment with a deployment branch policy allowing only
   `main` (no tag patterns). Store the write-capable Azure identity identifiers, backend identifier,
   `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, optional `ANTHROPIC_API_KEY` and optional integration
   credential settings there. Verify each value is present before deleting its repository copy.
2. Add the write app's federated credential for issuer `https://token.actions.githubusercontent.com`,
   audience `api://AzureADTokenExchange` and subject
   `repo:signalco-io@89613566/uier@1432139886:environment:production`. Keep both old subjects
   until all their callers have migrated, including the main-only email verification workflow.
3. Create a **preview** environment with required maintainer reviewers. Obtain the reviewer or
   team explicitly; do not select one automatically or approve runs on their behalf. Same-repository
   pull requests and manual CI on main must use this environment. Forks keep credential-free checks.
4. Provision a separate Entra preview app with its own environment subject. Start with Reader on
   the uier resource group. Give it only the backend blob access needed for state/preview locking,
   Key Vault cryptographic access needed to decrypt config, and narrowly scoped key reads still
   required by the program. Test the actual preview, then inspect direct and inherited roles to
   prove there is no Azure resource-write role. Do not copy the deployment app's Contributor role.
5. Supply separate provider preview credentials, with DNS read on `uier.io` for Cloudflare and
   the least Vercel project/team permissions available. Give previews no Anthropic key or production
   integration credentials. Refactor optional production variable registration so omitted preview
   secrets cannot plan a deletion. State access itself includes sensitive material and must remain
   behind the approval gate.

## Stage 3: separate builds and remove the worker environment pull

Change workflow authentication only after Stage 2 is provisioned and verified. `pulumi up` and
production deploys use the production environment; previews use the separate approved environment.
Retire the write app's `ref:refs/heads/main` and `pull_request` subjects only after every old caller
has a successful replacement run. Remove the repository-level production secrets after migration.

The Vercel build job must execute pull-request code without a deployment token. A separate deploy
job runs no checkout code and uploads only prebuilt output. Project settings/build variables must
reach the build without a production token; never transfer a pulled dotenv file in an artifact.
Inspect output for accidentally embedded secrets before enabling artifact upload. Credentials used
to upload a preview are distinct from production's token and remain behind preview approval.

For the notification/integration worker, choose one verified route before removing its key:

- A request-context worker on Vercel with a scheduler-only secret. Confirm the plan supports a
  five-minute schedule before selecting Vercel Cron; retain bounded delivery, retries and integrations.
- A GitHub worker using an independently scoped Azure OIDC data identity, with only the production
  environment values its transports/crypto need. Build before loading credentials, mask every loaded
  value, and use an explicit Azure credential rather than Vercel's request-only token helper.

Remove `vercel pull` and the full production environment file from notifications. A worker running
outside a Vercel request cannot reuse `getVercelOidcToken()` without an alternative credential path.
The current worker checks for `COSMOSDB_CONNECTION_STRING`; update that guard and test the chosen
credential before switching production. Connected-service encryption keys and provider credentials
are worker requirements too; copying only the mail settings would stop outbound integrations.

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

Final acceptance also needs a real infra pull request waiting for approval, a successful preview
under the separate identity, evidence of its effective roles, and a main push that successfully runs
both `pulumi up` and the production deploy. Keep #167 open until all live gates are recorded.

References: [GitHub secure workflow use](https://docs.github.com/en/actions/reference/security/secure-use),
[Cosmos DB data-plane RBAC](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control),
[Renovate action digest pins](https://docs.renovatebot.com/presets-helpers/#helperspingithubactiondigests).
