# uier

[uier.io](https://uier.io) lets you review a live website by leaving comments directly on the page.
A small toolbar is injected into the page (inside a shadow DOM, so it neither inherits nor leaks
styles), comments are pinned to page elements or selected text and stored per domain.
The uier.io landing page runs the toolbar itself as a [showcase](#landing-page-showcase-and-public-feedback):
anyone can try it and leave public feedback.

This repository contains:

- the **uier.io website and API** (Next.js, deployed to Vercel),
- the **review/comments toolbar** (a single classic-script bundle with its CSS inlined, served at `/toolbar.js`),
- the **infrastructure** for both (Pulumi: Vercel project, Cloudflare DNS, Azure Cosmos DB).

## Repository layout

| Path | Package | Description | License |
| --- | --- | --- | --- |
| [`apps/web`](apps/web) | `@uier/web` | uier.io website, `/api/comments` API (Next.js, Cosmos DB) and `/toolbar.js` | AGPL-3.0-only |
| [`packages/toolbar`](packages/toolbar) | `@uier/toolbar` | Review/comments toolbar bundled with tsup and mounted into a shadow DOM ([README](packages/toolbar/README.md)) | MIT |
| [`packages/brand`](packages/brand) | `@uier/brand` | The brand: design tokens, logo components, constants, assets and [`BRAND.md`](packages/brand/BRAND.md) | MIT |
| [`infra`](infra) | `@uier/infra` | Pulumi program for project `uier` (standalone pnpm project, own lockfile) | MIT |
| [`.github/workflows`](.github/workflows) | | CI, preview and deployment workflows | |

The root is a pnpm + [Turborepo](https://turborepo.com) workspace containing only `apps/*` and `packages/*`.
`infra/` is deliberately **not** part of that workspace: it has its own `package.json` and `pnpm-lock.yaml`,
so web development and web CI never install Pulumi dependencies.

The shared UI kit (`@signalco/ui`, `@signalco/ui-primitives`, `@signalco/cms-core`, ...) is consumed from npm.

Working with AI coding agents? Start at [`AGENTS.md`](AGENTS.md); every package has its own.

## Brand

The uier brand lives in the repository, not in a design tool:

- [`packages/brand/BRAND.md`](packages/brand/BRAND.md) is the written guide (name, voice, logo, colour,
  type, shape, the review layer).
- [`packages/brand`](packages/brand) implements it: `tokens.css` (CSS variables the web app and the toolbar
  load after the UI kit theme), `brand.ts` (constants), `<Logo />`, `<Mark />`, `<Pin />` and the SVG assets.
- [uier.io/brand](https://uier.io/brand) (`/brand` locally) renders all of it from that code, so it always
  shows the brand as it ships.

Change a value in `packages/brand`, update `BRAND.md`, re-render icons with `pnpm -C packages/brand icons`
if the mark changed, and check `/brand`.

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
pnpm dev
```

`pnpm dev` starts both packages through Turborepo:

| URL | What |
| --- | --- |
| http://localhost:4004 | `apps/web` (Next.js dev server) |
| http://localhost:4005/index.js | `packages/toolbar` (tsup watch build served from `dist/`); the web app loads this script instead of `/toolbar.js` |

- On the landing page (http://localhost:4004/) the toolbar runs in **showcase** mode: always mounted,
  with the first-run hint.
- On every other page it runs in **review** mode and mounts only when the URL has `?review=true`.
- Open the app on `localhost` (not `127.0.0.1`): the development toolbar build always talks to the local
  comments API on http://localhost:4004/api/comments, never to uier.io.

The comments API needs no database locally: without `COSMOSDB_CONNECTION_STRING` it keeps comments in
memory (lost on restart; one warning in the server log). To use a real Cosmos DB (an emulator or your own
serverless account), copy [`apps/web/.env.example`](apps/web/.env.example) to `apps/web/.env.local` and set
the variables there.

### Commands

Run from the repository root (each one runs the matching script in every package through Turborepo):

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the website (port 4004) and the toolbar watch build + server (port 4005) |
| `pnpm build` | Production build of the toolbar, then the website (which copies the toolbar to `apps/web/public/toolbar.js`) |
| `pnpm typecheck` | TypeScript checks |
| `pnpm test` | Playwright end-to-end tests of `apps/web` against the built app (`next start` on port 4004, in-memory comments store) |
| `pnpm -C packages/brand icons` | Re-render the PNG icon set in `apps/web/public` from the brand mark |

Before the first `pnpm test`, install the Playwright browser:

```bash
pnpm -C apps/web exec playwright install --with-deps chromium
```

The Playwright projects ([`apps/web/playwright.config.ts`](apps/web/playwright.config.ts)):

- **API** - [`comments.api.spec.ts`](apps/web/e2e/comments.api.spec.ts): the comments API with separate
  request contexts as separate visitors (ownership, validation, `413`, path filtering, DTO contents, cookie
  flags, rate limits).
- **Desktop Chrome** and **Mobile Chrome** - the landing page (render, security headers, axe, `/toolbar.js`)
  and the showcase toolbar ([`showcase.spec.ts`](apps/web/e2e/showcase.spec.ts)): point and text-selection
  comments, a second visitor who can reply but not resolve or delete, review mode on other pages. Each of
  these tests opens the site on an origin of its own (`<random>.localhost:4004`), so its comments are
  isolated from the other tests.

Tests that leave feedback through the toolbar load BotID's challenge script, which the app proxies to Vercel
(`api.vercel.com`), so they need network access.

## Landing page showcase and public feedback

The landing page (`/`) embeds the toolbar the same way a customer site would, in **showcase** mode:

```html
<script src="/toolbar.js" data-uier-mode="showcase"></script>
```

([`ToolbarScript`](apps/web/src/components/toolbar/ToolbarScript.tsx), rendered with `next/script`). The toolbar
is always mounted there and shows a dismissible first-run hint; anonymous visitors can leave point comments,
text-selection comments and replies. **Feedback is public**: every visitor sees every unresolved comment on
the page and can reply to it. Embedding options and the toolbar's modes are described in
[`packages/toolbar/README.md`](packages/toolbar/README.md).

### `/toolbar.js`

`pnpm build` in `apps/web` first copies the production bundle of `@uier/toolbar` (a workspace devDependency,
built before the web app through Turborepo's `^build`) to `apps/web/public/toolbar.js`
([`scripts/copy-toolbar.mjs`](apps/web/scripts/copy-toolbar.mjs); the copy is gitignored and a Turborepo build
output). It refuses to copy a development build. [`next.config.ts`](apps/web/next.config.ts) serves it with
`Content-Type: application/javascript`, `Cache-Control: public, max-age=300, s-maxage=3600` (the URL is not
versioned yet, so no `immutable`) and `Access-Control-Allow-Origin: *`. Vercel builds through Turborepo as well
(`buildCommand` in [`apps/web/vercel.json`](apps/web/vercel.json)), so `vercel build` produces it too.

The toolbar calls the comments API on the origin of its own script URL, so a preview deployment's landing
page talks to that preview's API. Embedding it on other sites is not supported by the API yet: it sends no
CORS headers, and BotID only protects requests from the same origin.

### Comments API

[`apps/web/app/api/comments`](apps/web/app/api/comments), implemented in
[`apps/web/src/lib/comments`](apps/web/src/lib/comments). JSON in and out; comments are partitioned by the
request's `Host` (the Cosmos DB partition key `domain`) and stored per page path (without query string and
trailing slash).

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/comments?path=/x` | | `200` comments of the page, newest first (max. 200), resolved ones included (`resolved: true`) |
| `POST /api/comments` | `{ path, position, text, quotedText?, device? }` | `201` the new comment |
| `POST /api/comments/{id}/replies` | `{ text }` | `201` the updated comment; anyone may reply |
| `PATCH /api/comments/{id}` | `{ resolved }` | `200` the updated comment; author only |
| `DELETE /api/comments/{id}` | | `204`; author only |
| `DELETE /api/comments/{id}/replies/{itemId}` | | `200` the updated comment; author of the reply only. Deleting the first item deletes the comment (`204`, author of the comment only) |

Errors are `{ "error": "<code>", "message": "..." }`: `400 invalid_request`, `403 forbidden` (not the
author), `403 bot_detected`, `404 not_found`, `413 too_large`, `429 rate_limited` (with `Retry-After` in
seconds) and `500 server_error`. Unknown fields are ignored; ids, authors and timestamps are always set by the
server. Responses never contain author ids, IP hashes, the TTL or device details other than the coarse size
(`desktop`/`tablet`/`mobile`). Texts are shown as plain text only (no markdown, no links).

**Anonymous identity.** Every `/api/comments` response sets the `uier_visitor` cookie when it is missing:
32 random bytes (base64url), `HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`, `Secure` everywhere except
plain http on a loopback host (local development and tests). Comments store only `authorId = sha256(token)`, never the token. Visitors are shown as
`Guest <first 4 hex characters of the author id>` (stable per visitor) and as "You" for their own items; the
API returns `isMine` / `author.isMe` so only the author sees the resolve and delete actions.

**Limits** (all in [`limits.ts`](apps/web/src/lib/comments/limits.ts); rate limits are sliding one-hour windows
counted from the stored comments, per domain):

| Limit | Value |
| --- | --- |
| Request body | 16 KB (`413`) |
| Comment / reply text | 1-1000 characters after trimming; quoted text up to 1000 |
| Path / selectors / selected text | 512 / 1024 / 2000 characters |
| Thread | 100 messages |
| New comments per visitor | 10 per hour |
| Replies per visitor | 30 per hour |
| Writes per IP (`sha256(ip + ':' + domain)`, never returned) | 30 per hour |
| Unresolved comments per page | 300 |

**Bot protection: [Vercel BotID](https://vercel.com/docs/botid)** (basic mode, no captcha).
[`instrumentation-client.ts`](apps/web/instrumentation-client.ts) attaches the BotID challenge to the page's
same-origin `POST`/`PATCH`/`DELETE` requests to `/api/comments*`, and every write handler calls `checkBotId()`
first (`403 bot_detected` for bots). `withBotId` in `next.config.ts` proxies BotID's scripts through this origin,
so the CSP needs no changes. BotID only verifies requests on Vercel: locally, in e2e tests and when
self-hosted every request is treated as human; `UIER_BOTID_DEV_BYPASS=BAD-BOT` (ignored on Vercel) simulates a
bot to test the `bot_detected` path.

**Retention.** Comments carry a Cosmos DB per-item `ttl`: they expire **90 days** after their last change
(7 days on preview deployments). The `comments` container has `defaultTtl: -1` (TTL enabled, nothing expires
without its own `ttl`).

**Storage.**

| Environment | Store |
| --- | --- |
| Vercel production | Cosmos DB container `comments` (`COSMOSDB_CONNECTION_STRING`, `COSMOSDB_COMMENTS_CONTAINER=comments`); a missing connection string is an error |
| Vercel preview (pull requests) | Cosmos DB container `comments-preview` in the same database (secondary account key, `defaultTtl` 7 days) |
| Local development, e2e tests | In memory, when `COSMOSDB_CONNECTION_STRING` is not set |

`COSMOSDB_COMMENTS_CONTAINER` selects the container (default `comments`). Both variables are managed by Pulumi
(see [Infrastructure](#infrastructure)).

### Removing abusive comments

There is no moderation UI yet. Remove comments directly in Cosmos DB:

1. Azure portal -> resource group `uier-production8b2f56d6` -> Azure Cosmos DB account `uierdb...` ->
   **Data Explorer** -> database `uierdata` -> container `comments` (`comments-preview` for preview deployments).
2. **New SQL Query**, e.g. all comments of the landing page:

   ```sql
   SELECT * FROM c WHERE c.domain = 'uier.io' AND c.path = '/' ORDER BY c._ts DESC
   ```

   (`domain` is the host the comment was posted on, e.g. `uier.io`; other useful filters:
   `CONTAINS(c.thread.items[0].text, 'spam')`, `c.authorId = '<authorId of a known abusive comment>'`,
   `c.ipHash = '<ipHash>'`.)
3. Open the document and **Delete** it to remove the whole comment, or remove the offending entry from
   `thread.items` and **Update** to remove a single reply. Changes are visible immediately (the API does
   not cache).

## Infrastructure

[`infra/`](infra) is the Pulumi project **`uier`** (Node.js runtime) with a single stack,
**`organization/uier/uier-production`**. It manages:

- the Vercel project **`uier`** (`prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc`, root directory `apps/web`, Node.js 24,
  function region `dub1`), its domain `uier.io` and the comments API variables: `COSMOSDB_CONNECTION_STRING`
  (production: the Cosmos DB account's primary key, preview: its secondary key) and
  `COSMOSDB_COMMENTS_CONTAINER` (production: `comments`, preview: `comments-preview`),
- the Cloudflare DNS record for `uier.io`,
- the Azure resource group `uier-production8b2f56d6` (Pulumi logical name `uier-production`) with a
  serverless Cosmos DB account (database `uierdata`, containers `comments` with per-item TTL enabled
  (`defaultTtl: -1`) and `comments-preview` (`defaultTtl` 7 days), both partitioned by `/domain`).

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

A ruleset on `main` requires a pull request with a passing **`CI OK`** check and blocks force pushes and deletions; "Allow auto-merge" is enabled on the repository.

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
