# Local development and testing

Set up the website and toolbar, then run the checks used for pull requests. For the short setup,
start with the [README](../README.md#run-locally).

## Prerequisites

- **Node.js 26** - the version is in [`.nvmrc`](../.nvmrc) (`nvm use` / `fnm use`).
- **pnpm** - via Corepack, which picks up the exact version pinned in the root `packageManager` field.
  Node.js 25 and later no longer include Corepack, so install it once:

  ```bash
  npm install --global corepack@latest
  corepack enable
  ```

- For infrastructure work only: the [Pulumi CLI](https://www.pulumi.com/docs/iac/download-install/) (CI pins
  the version used in [`pulumi_reusable.yml`](../.github/workflows/pulumi_reusable.yml), the same as `@pulumi/pulumi`
  in `infra/package.json`) and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).

## Browser support

The website and toolbar support the latest two stable major releases of Chrome, Edge, Firefox,
Safari and iOS Safari. The shared [`.browserslistrc`](../.browserslistrc) is consumed by Next.js
and the toolbar's esbuild targets; changes trigger web CI and invalidate Turborepo builds. Exact versions
come from the locked browser data and advance with dependency updates. To inspect them:

```sh
pnpm -C packages/toolbar exec browserslist
```

The toolbar bootstrap contains no legacy-browser polyfills. Its member check uses only the review
token, so guest-id generation stays in the review UI. Storage/CSP failure handling still applies
to supported browsers. The Tailwind v3 compatibility sheet maps UI-kit class names to Tailwind v4;
shadow-root property initialization is also required in current browsers. Neither is an old-browser
shim, and both stay in the deferred review bundle.

Browser build targets define the supported range; Playwright normally tests its bundled Chromium
on desktop and mobile. Optional Firefox/WebKit coverage is described [below](#full-regression-coverage).
The loader spec also supports those projects with `PLAYWRIGHT_CROSS_BROWSER=1`. It checks the
authenticated review-link fallback when WebKit rejects the Secure SSO cookie on the HTTP fixture;
this does not establish third-party-cookie acceptance or hosted HTTPS SSO.

## Local development

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts both packages through Turborepo:

| URL | What |
| --- | --- |
| http://localhost:4004 | `apps/web` (Next.js dev server) |
| http://localhost:4005/index.js | `packages/toolbar` (tsup watch build served from `dist-dev/`); the web app loads this script instead of `/toolbar.js` |

Sites you review locally can use the install snippet as it is: in `next dev`, http://localhost:4004/toolbar.js
(and the `review.js` its loader fetches, and the `audit.js` the Accessibility panel loads) is the watch build on port 4005, not the `public/toolbar.js` an
earlier `pnpm build` left behind (`next.config.ts`).

The watch build writes to `packages/toolbar/dist-dev/` and production builds to `dist/`, so
`pnpm typecheck`, `pnpm build` and `pnpm test` can run in the same checkout while `pnpm dev` keeps
serving the development toolbar. `next dev` imports the toolbar's modules from `dist-dev/` through the
`development` export condition in `packages/toolbar/package.json`; production builds, the extension
and Node scripts use `dist/`.

### Several checkouts side by side

`PORT` moves the pair: the website listens on `PORT` (default 4004) and the toolbar on the port after
it. The toolbar's watch build calls the API on `PORT`, and the website loads that toolbar and allows it
in its CSP. Give each git worktree its own `PORT`, at least two apart so the pairs don't overlap:

```bash
PORT=4104 pnpm dev   # website on 4104, toolbar on 4105
```

Each checkout builds its own `.next/` and toolbar output, and local data stays in each server's memory,
so the instances don't share comments or sign-ins. The toolbar server fails rather than switching
ports when its port is taken. Google and Microsoft sign-in redirect only to the 4004 callbacks you
registered, so on another port sign in with an email code.

Coding agents in the Claude desktop app start the same servers from
[`.claude/launch.json`](../.claude/launch.json). It runs `turbo run dev --ui stream`, because the
`--ui tui` in `pnpm dev` needs an interactive terminal. It prefers port 4004 with `autoPort`, so
when another checkout already runs there, the preview gets a free port through `PORT` and the
toolbar follows on the port after it. If the dev command or port changes, update that file too.

Realtime WebSocket upgrades use Vercel's native runtime. Ordinary `next dev`/`next start` keeps
the toolbar's adaptive polling and the app's 30-second fallback. To exercise the actual Vercel
upgrade locally use `vercel dev` with CLI 54.14.2 or newer and isolated local data settings; do not
pull production credentials. The standard development command remains unchanged.
`realtime.api.spec.ts` exercises the shared server session over real local WebSockets, including
privacy and revocation. `realtime.spec.ts` substitutes only the platform upgrade using Playwright's
WebSocket routing and exercises real tickets, writes and UI refreshes. Hosted native upgrades remain
a separate deployment acceptance check. See the [protocol](api.md#realtime-comment-changes).

- Every public page runs in **showcase** mode: always mounted. Only the landing page has the first-run hint
  and About uier; the other public pages, the app, reviews and embeds have neither. Feedback mode keeps
  its form focused.
- Project settings lets admins save a plain-text review brief (up to 2000 characters). Everyone who can
  comment under the current access setting can read it in the inbox; other visitors never
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

The Google sign-in option shows locally only with a Google client of your own in `apps/web/.env.local`
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, redirect URI `http://localhost:4004/app/sign-in/google/callback`;
see [Google sign-in](google-sign-in.md#create-the-google-oauth-client)). Without one, run the test stand-in
(`PORT=11004 node apps/web/e2e/support/googleStub.ts`) and point `GOOGLE_OAUTH_AUTHORIZE_URL`
(`http://127.0.0.1:11004/o/oauth2/v2/auth`), `GOOGLE_OAUTH_TOKEN_URL` (`.../token`) and `GOOGLE_OAUTH_ISSUER`
(`http://127.0.0.1:11004`) at it, with `GOOGLE_CLIENT_ID=google-test-client` and
`GOOGLE_CLIENT_SECRET=google-test-secret`. These overrides work only in local runtime.

The Microsoft sign-in option needs a separate Entra Web application client in `apps/web/.env.local`
(`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, redirect URI
`http://localhost:4004/app/sign-in/microsoft/callback`). See
[Microsoft sign-in](microsoft-sign-in.md) for registration and the local stand-in. First sign-in
confirms a chosen email once; a linked identity can then sign in directly.

Passkeys work locally on http://localhost:4004: browsers allow WebAuthn on `localhost` over plain
HTTP, and the relying party (RP ID `localhost`, origin `http://localhost:4004`) comes from the request's
host there, as it does on previews. They do not work on `127.0.0.1`, because an IP address can't be
an RP ID; the app says so instead of showing a browser error. A passkey made locally belongs to
`localhost` only, and the in-memory store forgets it on restart, while your password manager keeps
it: remove it there, or let the sign-in page tell the browser it is unknown. Adding a passkey needs
a sign-in from the last 10 minutes (Account offers Sign in again). Without a device, use Chrome
DevTools > More tools > WebAuthn to add a virtual authenticator; `e2e/passkeys.spec.ts` does the same
through the DevTools protocol.

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
| `pnpm dev` | Run the website (port 4004) and the toolbar watch build + server (port 4005); `PORT` moves both ([side by side](#several-checkouts-side-by-side)) |
| `pnpm build` | Production build of the toolbar, then the website (default `public/toolbar.js` loader, content-addressed loader/review scripts under `public/toolbar/` and archive manifest) |
| `pnpm typecheck` | TypeScript checks |
| `pnpm test` | All API tests and essential browser journeys against the built app (`next start` on `PORT`, default 4004, in-memory comments store) |
| `pnpm test:full` | All API and desktop/mobile browser regression tests |
| `pnpm -C packages/brand icons` | Re-render the PNG icon set in `apps/web/public` from the brand mark |

Before the first `pnpm test`, install the Playwright browser:

```bash
pnpm -C apps/web exec playwright install --with-deps chromium
```

The tests start their own server on port 4004 and local API stand-ins on `PORT + 1000` through
`PORT + 9000` (Anthropic, Notion, GitHub, Linear, Slack, Azure DevOps, Google, Microsoft and the project sites that
project icons come from). They use fake credentials and fail
if a port is taken: a running server is never reused, so `pnpm dev` (maybe with a real API key) is never tested
by mistake. To use another port, for example to run them in two worktrees at once or while `pnpm dev` holds
4004, set `PORT`:

```bash
PORT=4104 pnpm test
```

Keep every checkout's `PORT` between 4004 and 4999: a test run on 4104 also uses 5104 to 12104, so a
second run on 5104 would collide with it. Two test runs in the same checkout share its `test-results/`
and `playwright-report/`, so run them one after another there.

An existing server on that port is never reused, inside or outside CI.

### Test categories

| Category | Selection | Use |
| --- | --- | --- |
| API and service tests | `*.api.spec.ts`, project `API` | Focused logic, authorization, persistence and HTTP checks; these share one project rather than separate unit/integration runners |
| Desktop browser tests | Feature spec, project `Desktop Chrome` | UI and browser integration for the changed feature |
| Mobile browser tests | Feature spec, project `Mobile Chrome` | Touch, responsive layout and mobile behavior |
| Tablet browser tests | `tablet.spec.ts`, project `Tablet Chrome` | The app's layouts on a touch tablet in portrait and landscape; full suite only |
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

### Search indexing

See [search discovery](search-discovery.md) for structured data, public workflow guides,
Bing verification, IndexNow's content comparison and the disabled analytics status.

Public pages declare their pathname through `apps/web/src/lib/metadata.ts`. It keeps the
canonical, Open Graph URL and social metadata aligned with the page while retaining the brand's
title and description conventions. Canonicals always use `brand.url` (`https://uier.io`),
including when a page is requested with tracking parameters or on another host. See Google's
[canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

The build generates `/sitemap.xml` and its child sitemap with `next-sitemap.config.cjs`. Only
indexable public pages belong there. The dynamic `/status` page is added explicitly; app pages,
notification preferences, verification bridges, the manifest and the social images (the root card,
page cards such as `/features/feedback-triage/opengraph-image-*` and the app link cards under `/og/`)
are excluded. Modification dates are omitted until actual content changes can be tracked, rather than
advertising every deployment as a content update.

`robots.txt` permits crawling so search engines can read the app, notification and bridge pages'
`noindex` directives. A robots disallow rule can hide those directives and still leave a URL in
search results. Authentication remains responsible for app access. See Google's
[noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

After a production build, run the focused HTTP regression checks:

```bash
PORT=4104 pnpm -C apps/web exec playwright test e2e/seo.api.spec.ts --project=API --retries=0
```

The `uier.io` domain property in Google Search Console was verified on 2 November 2026 using a
Cloudflare Domain Connect TXT record. Preserve the `google-site-verification` record; it is managed
by that one-time verification flow, separately from Pulumi. `/sitemap.xml` was submitted successfully
and the homepage was indexed at the time of setup. The new property's reports were still processing;
submission does not establish indexing for every page. After deploying indexing changes, check
the sitemap status and representative URLs in Search Console.

### Required suite

`pnpm test` and pull-request CI run every `.api.spec.ts` once, plus browser essentials:
desktop checks tagged `@smoke` and mobile checks tagged `@mobile-smoke`.
The desktop checks cover the landing page and axe, sign-in redirect/code and single-use links,
CSP nonces and navigation policies, installation and the owner/guest comment lifecycle,
screenshots, text/rewrite/page feedback, routes, recovery and keyboard movement. Mobile repeats
the landing page, the owner/guest lifecycle and recovery/viewport controls.

All API tests remain required, including access, validation and persistence contracts. Detailed
feature permutations, repeated page/theme scans and load measurements remain available in the full
suite. Keep new browser regressions there unless they protect a critical journey.

The required run has no retries and a three-minute total timeout, with four workers in CI and
locally. CI runs the API project and desktop/mobile browser projects in separate jobs, alongside a
third job for typecheck, deployment artifact validation and standalone worker packaging. Both test
jobs build the current web app before testing; the extension job retains its own unit and packaged
runtime checks. Tagged browser tests can run in parallel within a file; API tests keep their file
ordering.
Traces are retained on failure; `playwright-report/results.json` records per-test and total timings
and is uploaded with the CI artifacts. `pnpm test:full` keeps the existing two retries and file ordering
without the three-minute budget. Turbo caches the two modes separately.

For specific browser regressions outside the required set, use the
[focused implementation commands](#while-implementing).

The toolbar loader has a 7.5 KB raw / 3.1 KB gzip build budget in `toolbar-assets.api.spec.ts`.
`toolbar-bootstrap.spec.ts` verifies that ordinary visitors never fetch the review script or fonts,
and covers concurrent loads, captured configuration, nonce/SRI, blocked storage, download retry and
feedback reopening. The review UI stays in a separate content-addressed script.

### Full regression coverage

The [MVP launch evidence matrix](mvp-launch-verification.md) maps the combined review flow to
coverage and records pending hosted/physical-device checks. `launch.spec.ts` adds owner/guest review,
canonical routes, capture and recovery checks; `launch-performance.spec.ts` records a 100-thread inbox,
loader/request budgets and host interaction timings, a 40-text-anchor search/index budget across
scroll, resize and DOM changes, and feedback capture on a 250-section page at normal and 4× slower CPU. Optional Firefox/WebKit projects run the portable
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
- **Desktop Chrome** and **Mobile Chrome** run the board's moves
  ([`comment-board.spec.ts`](../apps/web/e2e/comment-board.spec.ts)): dragging with the mouse (column states,
  the landing placeholder, Escape, to and from In progress, Ready to verify to In progress canceling the check), a refused drop, Move from the keyboard with its focus and announcement, a
  hold-and-move on a touch screen and a long press that selects instead (Mobile Chrome, through CDP touch events) and rollback when saving fails.
- **Desktop Chrome** and **Mobile Chrome** run users and invitations
  ([`users.spec.ts`](../apps/web/e2e/users.spec.ts)): a commenter invited to one project and an invited admin,
  single-use links, replaced and revoked invitations, the users list and its project filter, and deleting a
  member (their toolbar asks them to sign in again).
- **Tablet Chrome** (an iPad mini's 768 × 1024 with touch, in Chromium) runs only
  [`tablet.spec.ts`](../apps/web/e2e/tablet.spec.ts), in the full suite: the sidebar as a sheet in portrait and docked
  in landscape, the project header, settings, a thread in the list's place or beside it, the board's columns with a
  hold-and-move and the projects grid.
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

Browser verification, rewrite and AI thread title requests use the local Anthropic stand-in configured by
Playwright; the suite uses fake credentials and does not require live provider calls. Every new thread asks
the stand-in for a title, which it gives only for a `[stub:title:Words]` marker in the first message, so other
tests keep seeing first lines (`ai-titles.api.spec.ts` covers the title request with an injected fetch). `rewrite-accounting.api.spec.ts`
checks token pricing, outcomes, retries, missing usage, privacy and daily report coverage. The
[rewrite cost runbook](rewrite-costs.md) has the no-network comparison command and the separate bounded
live-evaluation procedure. Keep all automated checks on stubs.

### Responsiveness regressions

After building, run the delayed-response and request-budget checks on desktop and mobile:

```bash
PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test e2e/app-performance.spec.ts --project="Desktop Chrome" --project="Mobile Chrome" --retries=0
```

The tests reject server requests for presentation filters, hold mutation responses to prove the
UI updates before confirmation, and check rollback and reload persistence. These are local
behavior checks with in-memory storage, not a production Cosmos DB latency benchmark.
