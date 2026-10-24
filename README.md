# uier

[uier.io](https://uier.io) lets you review a live website by leaving comments directly on the page.
A small toolbar is injected into the page (inside a closed shadow DOM, so it neither inherits nor
leaks styles), comments are pinned to page elements and stored per domain.

This repository contains:

- the **uier.io website and API** (Next.js, deployed to Vercel),
- the **review/comments toolbar** (a single ESM bundle with its CSS inlined),
- the **infrastructure** for both (Pulumi: Vercel project, Cloudflare DNS, Azure Cosmos DB).

## Repository layout

| Path | Package | Description | License |
| --- | --- | --- | --- |
| [`apps/web`](apps/web) | `@uier/web` | uier.io website and `/api/comments` API (Next.js, Cosmos DB) | AGPL-3.0-only |
| [`packages/toolbar`](packages/toolbar) | `@uier/toolbar` | Review/comments toolbar bundled with tsup and mounted into a shadow DOM | MIT |
| [`infra`](infra) | `@uier/infra` | Pulumi program for project `uier` (standalone pnpm project, own lockfile) | MIT |
| [`.github/workflows`](.github/workflows) | | CI, preview and deployment workflows | |

The root is a pnpm + [Turborepo](https://turborepo.com) workspace containing only `apps/*` and `packages/*`.
`infra/` is deliberately **not** part of that workspace: it has its own `package.json` and `pnpm-lock.yaml`,
so web development and web CI never install Pulumi dependencies.

The shared UI kit (`@signalco/ui`, `@signalco/ui-primitives`, `@signalco/cms-core`, ...) is consumed from npm.

## Prerequisites

- **Node.js 24** - the version is in [`.nvmrc`](.nvmrc) (`nvm use` / `fnm use`).
- **pnpm** - via Corepack, which picks up the exact version pinned in the root `packageManager` field:

  ```bash
  corepack enable
  ```

- For infrastructure work only: the [Pulumi CLI](https://www.pulumi.com/docs/iac/download-install/) (CI pins
  the version used in [`pulumi_reusable.yml`](.github/workflows/pulumi_reusable.yml), the same as `@pulumi/pulumi`
  in `infra/package.json`) and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).

## Local development

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then fill in COSMOSDB_CONNECTION_STRING
pnpm dev
```

`pnpm dev` starts both packages through Turborepo:

| URL | What |
| --- | --- |
| http://localhost:4004 | `apps/web` (Next.js dev server) |
| http://localhost:4005/index.js | `packages/toolbar` (tsup watch build served from `dist/`); the web app's layout loads this script |

The toolbar mounts only when the page URL has `?review=true`, e.g. http://localhost:4004/?review=true.
The development toolbar build talks to the local comments API (http://localhost:4004/api/comments), never to
uier.io.

`COSMOSDB_CONNECTION_STRING` is only needed for the comments API. It is set (by Pulumi) only for the
Vercel **production** environment, so Vercel preview deployments and local development have no database
unless you provide one yourself (for example a Cosmos DB emulator or your own serverless account).

### Commands

Run from the repository root (each one runs the matching script in every package through Turborepo):

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the website (port 4004) and the toolbar watch build + server (port 4005) |
| `pnpm build` | Production build of the website and the toolbar |
| `pnpm typecheck` | TypeScript checks |
| `pnpm test` | Playwright end-to-end tests of `apps/web` against the built app (`next start` on port 4004) |

Before the first `pnpm test`, install the Playwright browser:

```bash
pnpm -C apps/web exec playwright install --with-deps chromium
```

## Infrastructure

[`infra/`](infra) is the Pulumi project **`uier`** (Node.js runtime) with a single stack,
**`organization/uier/uier-production`**. It manages:

- the Vercel project **`uier`** (`prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc`, root directory `apps/web`, Node.js 24,
  function region `dub1`), its domain `uier.io` and the production `COSMOSDB_CONNECTION_STRING` variable,
- the Cloudflare DNS record for `uier.io`,
- the Azure resource group `uier-production8b2f56d6` (Pulumi logical name `uier-production`) with a
  serverless Cosmos DB account (database `uierdata`, container `comments` partitioned by `/domain`).

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
account, database and container, Vercel project, `uier.io` DNS record) are `protect`ed: a change that would
delete or replace one of them fails instead of being applied.

Prefer letting CI apply changes (`pulumi up`) - see below.

## CI/CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | pull requests, manual | Web: typecheck, build, Playwright e2e and a Vercel preview deployment (URL in the job summary). Infra: `pulumi preview` against `uier-production`, posted as a PR comment. `CI OK` aggregates all jobs. |
| [`deploy.yml`](.github/workflows/deploy.yml) | push to `main`, manual | `pulumi up` first, then build and deploy the website to Vercel production (`uier.io`). |
| [`pulumi_reusable.yml`](.github/workflows/pulumi_reusable.yml) | called | Installs and builds `infra/`, logs into Azure (OIDC) and runs `pulumi preview` / `up`. |
| [`vercel-deploy_reusable.yml`](.github/workflows/vercel-deploy_reusable.yml) | called | `vercel pull`, `vercel build`, `vercel deploy --prebuilt`. |

- **`main`** is the only long-lived branch and is production: every push runs `pulumi up` and a Vercel
  *production* deployment served on `uier.io`.
- **Pull requests** target `main` and get a Vercel preview deployment and a `pulumi preview` (PRs from forks
  only run the checks that need no secrets).

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
`signalco-io` organization; see [`renovate.json`](renovate.json)). It waits until an npm release is one day
old - the same `minimumReleaseAge` pnpm enforces on install - and automerges selected minor/patch updates.

Also recommended: a ruleset on `main` requiring the **`CI OK`** status check, and "Allow auto-merge".

## Contributing

- Open pull requests against `main`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore(deps):` ...).

## History

This code was split out of the [signalco-io/signalco](https://github.com/signalco-io/signalco) monorepo
with its git history preserved (`web/apps/uier` -> `apps/web`, `web/packages/uier-toolbar` -> `packages/toolbar`,
`infra/apps/uier` -> `infra`). Issue and pull request references in older commit messages
(`signalco-io/signalco#1234`) point to the original repository.

## License

[`apps/web`](apps/web) is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
[`packages/toolbar`](packages/toolbar) and [`infra`](infra) are licensed under the MIT license, as declared in their
`package.json`. Anything without an explicit license is covered by the root [LICENSE](LICENSE) (AGPL-3.0).
