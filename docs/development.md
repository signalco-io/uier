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

### Testing MCP OAuth locally

OAuth for the [MCP connector](mcp.md) is on locally too. The issuer, the protected resource and the
consent page all come from the request host, and the app session cookie belongs to that host, so use
`http://localhost:4004` everywhere:

| What | Local address |
| --- | --- |
| MCP endpoint (the protected resource) | http://localhost:4004/api/mcp |
| Protected resource metadata | http://localhost:4004/.well-known/oauth-protected-resource/api/mcp |
| Authorization server metadata (issuer `http://localhost:4004`) | http://localhost:4004/.well-known/oauth-authorization-server |
| Consent | `http://localhost:4004/app/connect/<requestId>` |

When `UIER_BASE_URL` is set in `.env.local`, its origin is the issuer instead.

- To try Claude Code against the local server, add a separate entry:
  `claude mcp add --transport http uier-local http://localhost:4004/api/mcp`, then `/mcp` →
  Authenticate. Sign in with the link and code the sign-in page shows. Claude Code identifies itself
  with a metadata document on claude.ai, which the local server fetches over the internet.
- Loopback redirect URIs (`http://localhost`, `http://127.0.0.1`, `http://[::1]`) match on any port, so
  local clients and test listeners can pick an ephemeral port.
- Without Cosmos DB, connected apps and tokens live in memory. After a restart the client gets
  `invalid_token`, its refresh fails with `invalid_grant`, and it has to sign in again.
- The OAuth routes do not rate-limit local loopback requests.
- `UIER_MCP_OAUTH=off` in `.env.local` turns OAuth off, to check the access-token-only behavior.
- **Client metadata test switch.** Client ID Metadata Documents must be public HTTPS URLs.
  `UIER_OAUTH_TEST_HTTP_CLIENT_METADATA=1` also admits `http://localhost` and `http://127.0.0.1` URLs
  (any port, with a path), so tests can serve their own documents. It works only in the local runtime
  (`next dev` or `UIER_LOCAL=1`, never on Vercel); the Playwright test server sets it. Use it for local
  tests only and never set it on a deployment. Without it, a local test can use dynamic client
  registration instead, as the official SDK client does when it has no HTTPS metadata URL.

### Commands

Run from the repository root (each one runs the matching script in every package through Turborepo):

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the website (port 4004) and the toolbar watch build + server (port 4005) |
| `pnpm build` | Production build of the toolbar, then the website (default `public/toolbar.js`, content-addressed `public/toolbar/<sha256>.js` and archive manifest) |
| `pnpm typecheck` | TypeScript checks |
| `pnpm test` | All API tests and essential browser journeys against the built app (`next start` on `PORT`, default 4004, in-memory comments store) |
| `pnpm test:full` | All API and desktop/mobile browser regression tests |
| `pnpm -C packages/brand icons` | Re-render the PNG icon set in `apps/web/public` from the brand mark |

Before the first `pnpm test`, install the Playwright browser:

```bash
pnpm -C apps/web exec playwright install --with-deps chromium
```

The tests start their own server on port 4004 and local API stand-ins on `PORT + 1000` through
`PORT + 5000` (Anthropic, Notion, GitHub, Linear and Slack). They use fake credentials and fail
if a port is taken: a running server is never reused, so `pnpm dev` (maybe with a real API key) is never tested
by mistake. To use another port, for example to run them in two worktrees at once or while `pnpm dev` holds
4004, set `PORT`:

```bash
PORT=4104 pnpm test
```

An existing server on that port is never reused, inside or outside CI.

### Test categories

| Category | Selection | Use |
| --- | --- | --- |
| API and service tests | `*.api.spec.ts`, project `API` | Focused logic, authorization, persistence and HTTP checks; these share one project rather than separate unit/integration runners |
| Desktop browser tests | Feature spec, project `Desktop Chrome` | UI and browser integration for the changed feature |
| Mobile browser tests | Feature spec, project `Mobile Chrome` | Touch, responsive layout and mobile behavior |
| Required suite | `pnpm test` | All API/service tests and tagged browser essentials, before a PR and in CI |
| Full regression suite | `pnpm test:full` | Exceptional broad verification across every API and desktop/mobile case |

### While implementing

Run `pnpm typecheck` and the relevant feature tests. Select the spec file and one project,
starting with Desktop Chrome for browser work. Include Mobile Chrome when changing touch,
responsive layout or mobile behavior. Do not run the required suite after every edit, and do
not run the full suite just because you are implementing a feature or adding a regression test.

Direct Playwright commands do not rebuild the application. Run `pnpm build` after app or toolbar
changes so they exercise the current production build. The API project also uses this server
setup, including for in-process service tests. Then choose the relevant command, for example:

```bash
# API/service example: only this file, without browser projects.
PORT=4104 pnpm -C apps/web exec playwright test e2e/notion.api.spec.ts --project=API

# Browser example: only this feature on desktop, including its untagged cases.
PLAYWRIGHT_FULL=1 PORT=4104 pnpm -C apps/web exec playwright test e2e/drafts.spec.ts \
  --project="Desktop Chrome" --retries=0
```

Use the `e2e/` path in file arguments: Playwright matches them as regular expressions, so a bare
`drafts.spec.ts` also matches `assignment-mentions-drafts.spec.ts`.
`PLAYWRIGHT_FULL=1` lifts the smoke-tag filter; the file and project filters still apply, so the
browser example does not run the entire suite. `--retries=0` overrides full mode's two retries
for immediate feedback. Use `--project="Mobile Chrome"` for the mobile version, or append
`-g "part of the test title"` to narrow a file to one scenario. All these commands start their
own production server and local stubs; they do not attach to the dev server.

Before pushing code, dependency or build/test configuration changes, run
`pnpm typecheck && pnpm build && pnpm test` once the change is ready. That is the short required
suite. For documentation-only changes, validate content and links without application checks.
Run `pnpm test:full` only for broad regression verification when focused checks are insufficient
or a full run is explicitly requested. It is not a routine implementation or PR requirement.

### Required suite

`pnpm test` and pull-request CI run every `.api.spec.ts` once, plus **12 browser tests**:
nine desktop checks tagged `@smoke` and three mobile checks tagged `@mobile-smoke`.
The desktop checks cover the landing page and axe, sign-in redirect/code and single-use links,
CSP nonces and navigation policies, installation and the owner/guest comment lifecycle,
screenshots, text/rewrite/page feedback, routes, recovery and keyboard movement. Mobile repeats
the landing page, the owner/guest lifecycle and recovery/viewport controls.

The default previously ran 402 desktop/mobile cases. The essential set removes **97% of those
browser executions** while retaining all 382 API tests, including access, validation and persistence
contracts. Detailed feature permutations, repeated page/theme scans and load measurements remain
available in the full suite. Keep new browser regressions there unless they protect a critical journey.

The required run has no retries and a three-minute total timeout, with two workers in CI and four
locally. Tagged browser tests can run in parallel within a file; API tests keep their file ordering.
Traces are retained on failure; `playwright-report/results.json` records per-test and total timings
and is uploaded with the CI artifacts. `pnpm test:full` keeps the existing two retries and file ordering
without the three-minute budget. Turbo caches the two modes separately.

For specific browser regressions outside the required set, use the
[focused implementation commands](#while-implementing).

### Full regression coverage

The [MVP launch evidence matrix](mvp-launch-verification.md) maps the combined review flow to
coverage and records pending hosted/physical-device checks. `launch.spec.ts` adds owner/guest review,
canonical routes, capture and recovery checks; `launch-performance.spec.ts` records a 100-thread inbox,
bundle/request budgets and host interaction timings, plus a 40-text-anchor search/index budget across
scroll, resize and DOM changes. Optional Firefox/WebKit projects run the portable
launch flow with `PLAYWRIGHT_CROSS_BROWSER=1`; see the matrix for commands and engine limitations.

The Playwright projects ([`apps/web/playwright.config.ts`](../apps/web/playwright.config.ts)):

- **Desktop Chrome** and **Mobile Chrome** run a project's review flow
  ([`project-review.spec.ts`](../apps/web/e2e/project-review.spec.ts)) on a reviewed site on another origin that
  embeds the install guide's script and sends exactly the CSP sources it lists, without inline styles
  (any CSP violation fails, including point/text/inline threads, inbox and capture):
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
  It also posts through an SRI-checked pinned snippet, verifies both delivery headers, and covers
  named-element collisions, duplicate scripts and malformed/throwing window configuration.
- **API** - `toolbar-assets.api.spec.ts` checks archive carry-forward on a clean deployment,
  hash/fetch failures and expiry. `feedback-context.api.spec.ts` covers literal Markdown titles,
  names and metadata, including URLs/hosts and user/team mentions, with unchanged structured context.

Browser verification and rewrite requests use the local Anthropic stand-in configured by Playwright;
the suite uses fake credentials and does not require live provider calls.
