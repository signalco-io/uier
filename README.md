<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/brand/assets/logo-white.svg">
  <img src="packages/brand/assets/logo.svg" alt="uier" width="216" height="64">
</picture>

# Say it on the page.

Review any live website by leaving comments directly on it. Pin feedback to an element or selected
text, discuss it with your team, and mark it done. Each comment keeps the browser and viewport it
was left from, with a screenshot when capture succeeds. The server decodes and re-encodes every
screenshot before storage, removing embedded metadata and extra animation frames. Images stay
within 512 KB and 4096 px per side. Deleting feedback removes its image; scheduled cleanup retries
failed image deletes once unreferenced images are older than an hour.

[Try uier](https://uier.io) · [Open the app](https://uier.io/app) · [Documentation](docs/README.md) · [Contribute](CONTRIBUTING.md)

## How it works

1. Create a project for your site and add the script from its install guide.
2. Share a review link. Reviewers leave comments on the page, with invited access or guest access.
3. Manage feedback in the toolbar inbox or the app's list and board. Assign threads, reply, and resolve them.

Workspace admins can share selected projects with [teams](docs/teams-and-access.md). Team grants
add to individual access; external reviewers sign in, while public guest links stay separate.

You can try the toolbar on [uier.io](https://uier.io) itself. Feedback on its public pages is public.
To add it to your own site, follow the [embedding guide](packages/toolbar/README.md#embedding).

## Run locally

You need **Node.js 24** ([`.nvmrc`](.nvmrc)) and **pnpm through Corepack**. The repository pins the
pnpm version in [`package.json`](package.json).

```bash
git clone https://github.com/signalco-io/uier.git
cd uier
corepack enable
pnpm install
pnpm dev
```

Open [localhost:4004](http://localhost:4004). The toolbar builds and serves on port 4005 alongside
the website. Use `localhost` for the app so the development toolbar reaches the local API.

No database or email credentials are needed to get started. Local data stays in memory and resets
when the server restarts. On the [sign-in page](http://localhost:4004/app/sign-in), enter any email
address and use the sign-in link or code shown on the page.

For a persistent local database or optional rewrite suggestions, copy
[`apps/web/.env.example`](apps/web/.env.example) to `apps/web/.env.local` and set the relevant values.
See [local development and testing](docs/development.md) for the full setup and troubleshooting.

## Everyday commands

Run these from the repository root:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the website and toolbar watch build |
| `pnpm typecheck` | Check TypeScript across the workspace |
| `pnpm build` | Build the toolbar and website for production |
| `pnpm test` | Run all API tests and essential browser journeys against the production build |
| `pnpm test:full` | Run the full desktop/mobile browser regression suite and API tests |

Before the first test run, install Chromium:

```bash
pnpm -C apps/web exec playwright install --with-deps chromium
```

Stop the dev server before testing, or choose another port with `PORT=4104 pnpm test`.
Tests start their own app server and local API stand-ins on `PORT + 1000` through `PORT + 5000`.
While implementing, use typecheck and [focused feature tests](docs/development.md#while-implementing).
Run the short `pnpm test` check before a code PR; full regressions are exceptional.
See the [testing guide](docs/development.md#test-categories) for categories and browser options.

## `/toolbar.js`

The install guide offers the default `/toolbar.js` embed and **Pin this version** for HTML and
Next.js. The default follows new releases, with a five-minute browser cache and a one-hour CDN
cache. A pinned snippet uses `/toolbar/<sha256>.js`, a SHA-384 integrity check and anonymous CORS.
Its bytes stay unchanged and can be cached for one year.

**Caching and updates.** Pinned production bundles remain available and compatible with the review
API for one year after their last release as the current version. They get fixes only when you
update the snippet from the install guide. Production builds carry supported bundles forward;
preview and local pins belong to their own deployment. See [toolbar delivery](docs/api.md#toolbarjs)
for cache headers, retention and rollback details.

## Find your way around

This is a TypeScript monorepo using pnpm and Turborepo.

| Path | What lives here |
| --- | --- |
| [`apps/web`](apps/web) | Next.js website, signed-in app and APIs; deployed to Vercel |
| [`packages/toolbar`](packages/toolbar) | React review toolbar, bundled with tsup and isolated in a shadow DOM |
| [`packages/brand`](packages/brand) | Shared design tokens, logo components, copy and assets |
| [`infra`](infra) | Pulumi infrastructure for Vercel, Cloudflare and Azure Cosmos DB |

The pnpm workspace includes `apps/*` and `packages/*`. Infrastructure has its own dependencies
and lockfile; install them separately only when working on infrastructure.

Production uses HTTPS cookies named `__Host-uier_visitor`, `__Host-uier_session`,
`__Host-uier_sign_in_request`, `__Host-uier_workspace` and `__Secure-uier_review_sso`.
Plain HTTP local runs keep the unprefixed names. See the [web guide](apps/web/AGENTS.md#page-security-and-cookie-migration)
for the bounded transition from old names. Cloudflare serves the apex A record, the `www` CNAME,
and a CAA record authorizing Vercel's certificate issuer, Let's Encrypt; see [operations](docs/operations.md).

## Go deeper

The [CI credential rollout](docs/ci-credential-rollout.md) tracks the staged move to protected
GitHub environments and production Cosmos DB identity access. Infrastructure and GitHub setup
are documented in [Infrastructure and operations](docs/operations.md#required-github-configuration).

| Guide | Start here when you want to… |
| --- | --- |
| [Documentation index](docs/README.md) | Find a reference or implementation plan |
| [Toolbar guide](packages/toolbar/README.md) | Embed the toolbar and configure review modes |
| [Review workflow](docs/review-workflow.md) | Understand projects, permissions, screenshots and feedback recovery |
| [API reference](docs/api.md) | Work with review and comments APIs or toolbar delivery |
| [Coding tool access (MCP)](docs/mcp.md) | Connect a coding tool to selected project feedback |
| [Connected services](docs/integrations.md) | Mirror feedback to Notion, GitHub or Linear, or send Slack notifications |
| [Brand guide](packages/brand/BRAND.md) · [Live brand page](https://uier.io/brand) | Work with the uier identity and shared tokens |
| [Infrastructure and operations](docs/operations.md) | Work on deployment, service checks or maintenance |
| [Backups and restore](docs/backups-and-restore.md) | Recover accidental deletions and inspect the recorded restore drill |

## Removing abusive comments

Every account joins the shared uier project as a commenter. The encrypted staff allowlist grants
admin access automatically on sign-in and app requests; no invitation or manual project membership
is needed. Staff can see private app feedback as well as public comments.

1. Switch to **uier → uier.io public feedback** in the app.
2. Use **More from this author** to filter threads they opened or replied to.
3. Choose **Delete** for a thread and screenshot, or expand replies and choose **Delete reply**.
4. To add or remove staff, update the complete `uier:staffEmails` list with Pulumi's secret prompt,
   commit only encrypted configuration through a reviewed PR, and let CI deploy it.

The [moderation procedure](docs/operations.md#removing-abusive-comments) has the exact secret-config
command, deployment checks and the Cosmos DB fallback. Never delete comment-number sequences or
rate-limit counters. Personal workspaces and onboarding stay unchanged.

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
workflow, code conventions and checks. Coding agents should also read [AGENTS.md](AGENTS.md).
Report security problems through [SECURITY.md](SECURITY.md).

## License

The website and API in `apps/web`, and files without an explicit license, use
[AGPL-3.0-only](LICENSE). The toolbar, brand package and infrastructure use MIT, as declared in
their `package.json` files. [The open source page](https://uier.io/open-source) explains the licenses.

A [signalco](https://signalco.io) project.
