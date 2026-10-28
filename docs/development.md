# Local development and testing

Set up the website and toolbar, then run the checks used for pull requests. For the short setup,
start with the [README](../README.md#run-locally).

## Prerequisites

- **Node.js 24** - the version is in [`.nvmrc`](../.nvmrc) (`nvm use` / `fnm use`).
- **pnpm** - via Corepack, which picks up the exact version pinned in the root `packageManager` field:

  ```bash
  corepack enable
  ```

- For infrastructure work only: the [Pulumi CLI](https://www.pulumi.com/docs/iac/download-install/) (CI pins
  the version used in [`pulumi_reusable.yml`](../.github/workflows/pulumi_reusable.yml), the same as `@pulumi/pulumi`
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

- Every public page runs in **showcase** mode: always mounted, with the first-run hint.
- Review links also show the first-run guide. About uier reopens it; dismissal is remembered per API
  and project on the reviewed site. Feedback mode keeps its form focused without opening the guide.
- Project settings lets admins save a plain-text review brief (up to 2000 characters). Everyone who can
  comment under the current access setting can read it in the guide and inbox; other visitors never
  receive it. Blank input clears it. HTML, Markdown and URLs remain literal text.
- Review links (`?toolbar-code=<project code>` or `?review=true`) start **review** mode instead; the
  review continues in that tab until "Exit review". In development the signed-in app loads review mode only.
- Open the app on `localhost` (not `127.0.0.1`): the development toolbar build always talks to the local
  comments API on http://localhost:4004/api/comments, never to uier.io.

The comments API and the app need no database locally: without `COSMOSDB_CONNECTION_STRING` (or
`COSMOSDB_ENDPOINT`) they keep their data in memory (lost on restart; one warning in the server log). To use a
real Cosmos DB (an emulator or your own serverless account), copy [`apps/web/.env.example`](../apps/web/.env.example)
to `apps/web/.env.local` and set the variables there.

No email is sent locally either: the sign-in page shows the link and code it would have emailed
("Open the sign-in link" and the eight-digit code), so http://localhost:4004/app works with any address.

### Commands

Run from the repository root (each one runs the matching script in every package through Turborepo):

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the website (port 4004) and the toolbar watch build + server (port 4005) |
| `pnpm build` | Production build of the toolbar, then the website (which copies the toolbar to `apps/web/public/toolbar.js`) |
| `pnpm typecheck` | TypeScript checks |
| `pnpm test` | Playwright end-to-end tests of `apps/web` against the built app (`next start` on `PORT`, default 4004, in-memory comments store) |
| `pnpm -C packages/brand icons` | Re-render the PNG icon set in `apps/web/public` from the brand mark |

Before the first `pnpm test`, install the Playwright browser:

```bash
pnpm -C apps/web exec playwright install --with-deps chromium
```

The tests start their own server on port 4004 (and a stand-in for the Anthropic API on `PORT + 1000`) and fail
if a port is taken: a running server is never reused, so `pnpm dev` (maybe with a real API key) is never tested
by mistake. To use another port, for example to run them in two worktrees at once or while `pnpm dev` holds
4004, set `PORT`:

```bash
PORT=4104 pnpm test
```

An existing server on that port is never reused, inside or outside CI.

The [MVP launch evidence matrix](mvp-launch-verification.md) maps the combined review flow to
coverage and records pending hosted/physical-device checks. `launch.spec.ts` adds owner/guest review,
canonical routes, capture and recovery checks; `launch-performance.spec.ts` records a 100-thread inbox,
bundle/request budgets and host interaction timings. Optional Firefox/WebKit projects run the portable
launch flow with `PLAYWRIGHT_CROSS_BROWSER=1`; see the matrix for commands and engine limitations.

The Playwright projects ([`apps/web/playwright.config.ts`](../apps/web/playwright.config.ts)):

- **Desktop Chrome** and **Mobile Chrome** run a project's review flow
  ([`project-review.spec.ts`](../apps/web/e2e/project-review.spec.ts)) on a reviewed site on another origin that
  embeds the install guide's script and sends exactly the CSP sources it lists (any CSP violation fails):
  invited people (review link sign-in, "Sign in" for others), guests with names, comments off, other sites
  refused (CORS) with privacy-safe copyable owner notes, ended-session sign-in, offline recovery,
  and the app's comment list, board, filters, private comments, assignees, edit, delete,
  usage and links to comments.
- **Desktop Chrome** and **Mobile Chrome** run users and invitations
  ([`users.spec.ts`](../apps/web/e2e/users.spec.ts)): a commenter invited to one project and an invited admin,
  single-use links, replaced and revoked invitations, the users list and its project filter, and deleting a
  member (their toolbar asks them to sign in again).
- **Desktop Chrome** and **Mobile Chrome** also run the app ([`app.spec.ts`](../apps/web/e2e/app.spec.ts)):
  sign-in (single-use links, redirects back), onboarding and the install guide, review links, done and
  reopened projects, project settings, the sidebar and the account page, with axe checks on every page.
- **API** - [`comments.api.spec.ts`](../apps/web/e2e/comments.api.spec.ts): the comments API with separate
  request contexts as separate visitors (ownership, deleting threads others replied to, validation, `413`,
  path filtering, DTO contents, cookie flags, rate limits).
- **Desktop Chrome** and **Mobile Chrome** - the landing page (render, security headers, axe, `/toolbar.js`)
  and the showcase toolbar ([`showcase.spec.ts`](../apps/web/e2e/showcase.spec.ts)): point and text-selection
  comments (the hover outline, the thread that opens after posting; text anchors, restored highlights, missing-anchor
  recovery and the viewport are in [`anchors.spec.ts`](../apps/web/e2e/anchors.spec.ts)), a second visitor who can reply but not
  resolve or delete, Done and comment links, a deleted comment whose replies stay,
  review mode on other pages. Review links, the review session and the toolbar's controls (collapse, profile,
  options, sign out) are in [`review.spec.ts`](../apps/web/e2e/review.spec.ts). Each of these tests opens the site
  on an origin of its own (`<random>.localhost:4004`, on the test port), so its comments are isolated from the
  other tests. [`embed.spec.ts`](../apps/web/e2e/embed.spec.ts) loads `/toolbar.js` on a reviewed site on another
  origin (a small server on `reviewed.localhost`) and checks that it leaves that site's styles alone.

Tests that leave feedback through the toolbar load BotID's challenge script, which the app proxies to Vercel
(`api.vercel.com`), so they need network access.
