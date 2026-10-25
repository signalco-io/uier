# uier

[uier.io](https://uier.io) lets you review a live website by leaving comments directly on the page.
A small toolbar is injected into the page (inside a shadow DOM, so it neither inherits nor leaks
styles), comments are pinned to page elements or selected text and stored per domain.
Every public uier.io page runs the toolbar itself as a [showcase](#landing-page-showcase-and-public-feedback):
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

The shared UI kit (`@signalco/ui`, `@signalco/ui-primitives`, `@signalco/cms-core`, ...) is consumed from
npm and builds the public pages. The signed-in app (`/app`) is built from [shadcn/ui](https://ui.shadcn.com)
components, added as source to `apps/web/src/components/ui` (`components.json`) and themed with the same
brand tokens.

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

- Every public page runs in **showcase** mode: always mounted, with the first-run hint.
- Review links (`?toolbar-code=<project code>` or `?review=true`) start **review** mode instead; the
  review continues in that tab until "Exit review". In development the signed-in app loads review mode only.
- Open the app on `localhost` (not `127.0.0.1`): the development toolbar build always talks to the local
  comments API on http://localhost:4004/api/comments, never to uier.io.

The comments API and the app need no database locally: without `COSMOSDB_CONNECTION_STRING` (or
`COSMOSDB_ENDPOINT`) they keep their data in memory (lost on restart; one warning in the server log). To use a
real Cosmos DB (an emulator or your own serverless account), copy [`apps/web/.env.example`](apps/web/.env.example)
to `apps/web/.env.local` and set the variables there.

No email is sent locally either: the sign-in page shows the link it would have emailed
("Open the sign-in link"), so http://localhost:4004/app works with any address.

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

The [MVP launch evidence matrix](docs/mvp-launch-verification.md) maps the combined review flow to
coverage and records pending hosted/physical-device checks. `launch.spec.ts` adds owner/guest review,
canonical routes, capture and recovery checks; `launch-performance.spec.ts` records a 100-thread inbox,
bundle/request budgets and host interaction timings. Optional Firefox/WebKit projects run the portable
launch flow with `PLAYWRIGHT_CROSS_BROWSER=1`; see the matrix for commands and engine limitations.

The Playwright projects ([`apps/web/playwright.config.ts`](apps/web/playwright.config.ts)):

- **Desktop Chrome** and **Mobile Chrome** run a project's review flow
  ([`project-review.spec.ts`](apps/web/e2e/project-review.spec.ts)) on a reviewed site on another origin that
  embeds the install guide's script and sends exactly the CSP sources it lists (any CSP violation fails):
  invited people (review link sign-in, "Sign in" for others), guests with names, comments off, other sites
  refused (CORS), and the app's comment list, board, filters, private comments, assignees, edit, delete,
  usage and links to comments.
- **Desktop Chrome** and **Mobile Chrome** run users and invitations
  ([`users.spec.ts`](apps/web/e2e/users.spec.ts)): a commenter invited to one project and an invited admin,
  single-use links, replaced and revoked invitations, the users list and its project filter, and deleting a
  member (their toolbar asks them to sign in again).
- **Desktop Chrome** and **Mobile Chrome** also run the app ([`app.spec.ts`](apps/web/e2e/app.spec.ts)):
  sign-in (single-use links, redirects back), onboarding and the install guide, review links, done and
  reopened projects, project settings, the sidebar and the account page, with axe checks on every page.
- **API** - [`comments.api.spec.ts`](apps/web/e2e/comments.api.spec.ts): the comments API with separate
  request contexts as separate visitors (ownership, deleting threads others replied to, validation, `413`,
  path filtering, DTO contents, cookie flags, rate limits).
- **Desktop Chrome** and **Mobile Chrome** - the landing page (render, security headers, axe, `/toolbar.js`)
  and the showcase toolbar ([`showcase.spec.ts`](apps/web/e2e/showcase.spec.ts)): point and text-selection
  comments (the hover outline, the thread that opens after posting; text anchors, restored highlights, missing-anchor
  recovery and the viewport are in [`anchors.spec.ts`](apps/web/e2e/anchors.spec.ts)), a second visitor who can reply but not
  resolve or delete, Done and comment links, a deleted comment whose replies stay,
  review mode on other pages. Review links, the review session and the toolbar's controls (collapse, profile,
  options, sign out) are in [`review.spec.ts`](apps/web/e2e/review.spec.ts). Each of these tests opens the site
  on an origin of its own (`<random>.localhost:4004`, on the test port), so its comments are isolated from the
  other tests. [`embed.spec.ts`](apps/web/e2e/embed.spec.ts) loads `/toolbar.js` on a reviewed site on another
  origin (a small server on `reviewed.localhost`) and checks that it leaves that site's styles alone.

Tests that leave feedback through the toolbar load BotID's challenge script, which the app proxies to Vercel
(`api.vercel.com`), so they need network access.

## The app (`/app`)

The signed-in app at [uier.io/app](https://uier.io/app) ("Get started" on the landing page), in
[`apps/web/app/(rest)/(app)`](apps/web/app/(rest)/(app)) with its logic in
[`apps/web/src/lib/app`](apps/web/src/lib/app). Pages are server components; changes go through server
actions that check the session and the role every time.

The app is a sidebar layout (shadcn/ui `Sidebar`, inset variant): the workspace at the top (a menu switches
between workspaces), Users (admins), the active projects for quick switching (their header links to all
projects and, for admins, to a new one), and at the bottom "Give feedback" (uier's own toolbar, see
[public feedback](#landing-page-showcase-and-public-feedback)) and the account menu (account, theme, sign out). It
collapses to icons on desktop (`Ctrl/Cmd+B`) and opens as a sheet on small screens. A top bar holds the
breadcrumbs. uier is free, so there is no billing page; pricing is the landing page's `brand.pricing` promise.

- **Sign in** (`/app/sign-in`): no passwords. The app emails a single-use link (valid for 15 minutes, stored
  only as a SHA-256 hash); the first sign-in creates the account. Opening the link shows a "Continue"
  button, because email scanners open links before people do. The session is an HttpOnly `uier_session`
  cookie with a signed token (30 days; the key is derived from the server secret, like the guest names).
  Sign-in emails are limited to 5 per address and 20 per IP per hour. Signed-out visits to an app page go
  to sign in and come back afterwards (`proxy.ts`, `?next=`).
- **Workspaces**: every user gets a workspace of their own on first sign-in and is its admin. Projects and
  members belong to a workspace; with more than one workspace the menu at the top of the sidebar switches
  between them.
- **Projects** (`/app/projects`): one project per reviewed site, with its addresses (the main site first,
  then staging or preview addresses), its status (active or done) and who can comment. The page shows the
  active or done projects as cards with their open comments, who can comment and review links.
  An optional client name (up to 80 characters, with whitespace normalized) can be set at creation or
  in settings. It appears in project details and cards. The client filter sits beside Active/Done,
  offers All clients and No client, and stays selected in the URL across status changes and reloads.
  Client choices come only from projects the current member can see in the current workspace. The project
  code (12 lowercase letters and digits) is public: it is in the embed script.
  - Onboarding: `/app/projects/new` (the addresses), then the install guide `/app/projects/<code>/install`
    (the script, where to paste it on common platforms, and the CSP sources in "Advanced").
  - A project has a header (name, addresses, who can comment, Invite and Open review) and three tabs:
    Comments, Install and Settings (admins).
  - Comments `/app/projects/<code>`: the guest link (in guest mode) and the project's **comments**, as a
    list or a board (Open / Done), filtered by people (all, assigned to me, opened by me) and page (relative
    URLs). Each comment shows its page URL, the device size it came from, when it was created, its author,
    assignee, replies and state, with Done, Link to comment and Assign; the author or an admin edits and
    deletes it, and only admins make it private.
  - Install `/app/projects/<code>/install`: the install guide with the project code and **Check installation**.
    The check opens the actual configured site, confirms the script's project/API, reads comments and obtains a
    browser-verification proof without posting a test comment. CSP failures are diagnosed where browser evidence
    exists; missing scripts, private/unreachable sites, changed origins and interrupted checks stay inconclusive.
    Reports check the window, origin and a temporary nonce; no tokens, reviewer identity or page content are reported.
  - Settings `/app/projects/<code>/settings`: name, optional client name, who can comment (invited people, anyone with the link,
    or comments off), addresses, meaningful page-state fields, usage (comments, open, done, replies, pages, people with access), done.
  - Review links `/app/review/<code>?url=<page>&comment=<id>` check access and redirect to the page with the
    toolbar's review link parameter `?toolbar-code=<code>`, a single-use code that signs the toolbar in
    (`uier-token`) and the comment to open (`uier-comment`); only addresses of the project are redirect
    targets.
- **Users** (`/app/users`, admins only): the people in the workspace with their role (admin or commenter)
  and the projects they review, filtered by project (`?project=`), and the pending invitations. Admins
  remove people (the last admin stays) and revoke invitations. A removed member's review token stops
  working at once, because the review API checks the membership on every request.
  - Invite (a dialog from the users page, a project's header or its card menu): the email, the role and,
    for commenters, the selected projects or all projects. The email links to `/app/invitation?token=` (single use, 7 days,
    stored only as a SHA-256 hash; 50 invitations per workspace per day). Inviting the same address again
    replaces the earlier invitation. Accepting takes a click, like signing in: it signs the invited person
    in (their account is created on first use), adds them to the workspace and opens the project's review
    link, or the projects when the invitation has no project.
- **Account** (`/app/account`): the name shown with comments, the theme (light, dark or system) and
  sign out.

### Assignment and mentions

Signed-in project members can change a thread's assignee in its toolbar details or inbox.
The app and toolbar use the same assignment service. Assigned to me combines with page,
status and search filters. Guests see the assignee's name but cannot change assignment or
look up the participant directory. Removed members appear as Former member (no access);
the assignment can be cleared or changed.

In a member's composer, type @ to search eligible participants. Arrow keys move through
suggestions; Enter or Tab selects without posting; Escape dismisses. Touch/click selects
the same account. A short opaque account suffix distinguishes duplicate display names.
Selection saves an account id and a text range, not a display-name match. Editing through
a mention turns it back into plain text. Names update when reading saved mentions; removed
accounts appear as Former member. New mention and assignment targets must currently have
project access and visibility of the thread (private threads: admins and the author).
Neither action creates membership or bypasses private-thread checks.
Assignment changes and newly selected mention recipients use the shared unread activity
cursor and five-minute email digest. A post with mentions still creates one event. Repeated
assignment selections and edits retaining the same recipients create no extra event. The
actor, read activity, muted projects, explicitly unfollowed threads, removed members and
people without private-thread access are suppressed by the shared notification delivery.
Unassignment targets the previous assignee, subject to the same rules.

### Review API (a project's toolbar)

A project's toolbar (`data-uier-project`, see the [toolbar README](packages/toolbar/README.md)) runs on the
customer's site and calls `/api/review/<code>` on uier.io, implemented in
[`apps/web/src/lib/review`](apps/web/src/lib/review). The routes mirror the comments API:

| Request | What |
| --- | --- |
| `GET /api/review/<code>` | the project (name, who can comment, page-state policy), the reviewer and whether they can comment, the sign-in URL |
| `POST /api/review/<code>/session` | `{ code }`: exchanges a review link's single-use code (10 minutes) for a review token (30 days) |
| `POST /api/review/<code>/verification` | same-origin BotID verification from the empty `/review-verification` frame; a five-minute proof bound to the reviewed origin, project and reviewer |
| `GET`, `POST /api/review/<code>/comments` | the comments of a page (`?path=`) or of every page (`?scope=site`, the inbox) the reviewer can see, a new comment (`authorName` from guests) |
| `POST /api/review/<code>/comments/<id>/replies`, `PATCH`/`DELETE /api/review/<code>/comments/<id>`, `PATCH`/`DELETE .../replies/<itemId>` | replies, done (`resolved`), editing messages (`text`, `expectedText`), deleting |
| `GET /api/review/<code>/comments/<id>/screenshot` | the comment's screenshot, for reviewers who can see the comment |
| `PATCH /api/review/<code>/comments/<id>/anchor` | reattach with `{ path, position, expectedRevision }`; author/admin, saved page and original allowed origin only |
| `POST /api/review/<code>/comments/<id>/screenshot` | supply or replace saved evidence, with `{ screenshot, expectedRevision }`; author or workspace admin only |
| `POST /api/review/<code>/rewrite` | `{ text, instruction? }`: rewrite suggestions, as `POST /api/rewrite`, for reviewers who can comment (limited per reviewer and per project, and app-wide like `POST /api/rewrite`) |

- **Who**: a member with access, by the review token (`Authorization: Bearer`), or a guest, by a random
  visitor id (`X-Uier-Visitor`) and the name they give. No cookies: the API is another site than the
  reviewed one.
- **Who can comment** is enforced here: `403 comments_disabled` when comments are off, `401
  sign_in_required` for anyone but members when the project is for invited people.
- **CORS**: only the project's own site addresses get `Access-Control-Allow-Origin` (no credentials);
  requests from any other origin get `403`.
- **Permissions**: members mark any comment done, the author and the workspace admins delete it, private
  comments are listed only to admins and their author. Comments carry `permissions` and `canDelete`.
- Comments live in the comments container under the partition `project:<code>`, with the site's origin,
  the author (`user:<id>` for members) and no TTL. The same rate limits as the comments API apply.
- **Bot protection**: writes on uier's origin use BotID directly. On reviewed sites, the toolbar opens an
  empty frame on uier's origin so BotID can verify there, without third-party cookies. The frame checks
  its parent's browser-supplied origin against the project's addresses and returns a signed five-minute
  proof. Every cross-origin write needs that proof in `X-Uier-Verification`, bound to its origin, project
  and reviewer. Only `/review-verification` can be framed; other pages keep their framing protection.
  The install guide includes `frame-src` for the API origin. BotID failures stop writes.

Data lives in the Cosmos DB container `app` (`app-preview` on previews), partition key `/pk`:

| Document (`type`) | `pk` | `id` |
| --- | --- | --- |
| `user` | `user:<id>` | `u_<nanoid>` |
| `user-email` (unique email -> user) | `email:<email>` | the email |
| `sign-in` (pending link, `ttl` 15 min) | `sign-in:<hash>` | SHA-256 of the token |
| `workspace`, `member`, `project` | `workspace:<id>` | `w_<userId>`, `member_<userId>`, the project code |
| `project-ref` (code -> workspace) | `project:<code>` | the project code |
| `review-code` (single-use code of a review link, `ttl` 10 min) | `review-code:<hash>` | SHA-256 of the code |

Email goes through Azure Communication Services (`ACS_CONNECTION_STRING`, sender `UIER_EMAIL_SENDER`, both
set by Pulumi). Links in emails use `https://uier.io` in production and the deployment URL on previews
(`UIER_BASE_URL` overrides both); never the request's Host header.

### Review email notifications

Owners and admins receive new feedback. Members automatically follow threads they post in, can follow or
unfollow any visible thread, and can mute project emails from the toolbar or app. Guests can
optionally choose **Email me replies** after commenting and verify an address; neither email nor
an account is required to post. Related unread activity is batched for five minutes, with current
access, mute, unsubscribe and shared read-cursor checks before sending. A scheduled GitHub workflow
uses the existing production Cosmos/ACS configuration; no detached serverless work is used.

See [the delivery contract and operations guide](docs/review-notifications.md) for defaults,
verification, retention, retry evidence, scheduler delays and the #83/#91 integration contract.

## Landing page showcase and public feedback

Every public page embeds the toolbar from the marketing layout in **showcase** mode:

```html
<script src="/toolbar.js" data-uier-mode="showcase"></script>
```

([`ToolbarScript`](apps/web/src/components/toolbar/ToolbarScript.tsx), which renders the toolbar's React component
`<UierToolbar mode="showcase" />` from `@uier/toolbar/react`). The toolbar
is always mounted on public pages and shows a dismissible first-run hint; anonymous visitors can leave point comments,
text-selection comments and replies. **Feedback is public**: every visitor sees every unresolved comment on
the page and can reply to it. Embedding options and the toolbar's modes are described in
[`packages/toolbar/README.md`](packages/toolbar/README.md).

The static project `uier00000001` and workspace `w_uier_public` are created in the deployment's
`app` container on the first public API request. The two starter threads are created in `comments`
with stable ids and `ttl: -1` (no expiry). Provisioning is create-only and safe across concurrent
cold starts: it preserves replies, status and numbers. Production feedback previously stored under
`uier.io` is copied once, with a persistent migration receipt; source records remain untouched.
Previews use only their configured preview containers. Local subdomains keep independent, unseeded
partitions for testing.

The hero's `data-uier-thread="comment_uier_headline"` slot renders a live thread in an open shadow
root, sharing the toolbar's components, queries and anonymous visitor cookie. Both hero pins and the
text highlight come from stored comments. The inbox includes other public pages. Explicit review
links still start review mode; the signed-in app does not automatically publish a showcase.

The app's **Give feedback** button (sidebar, above the account) opens the same toolbar on the app page in
`feedback` mode, with its feedback form open (`openUierFeedback()` from `@uier/toolbar/react`). App pages show
people's private projects, so on the public project every comment on an `/app` page is **private**: only its
author and the uier team (the public project's admins, in the app) see it, in both comments APIs, whichever
toolbar left it. Comments the team makes private there are hidden from other visitors as well.

### `/toolbar.js`

Collapsing the toolbar hides on-page comment pins, text highlights, comment popovers and inline threads, leaving the page
free to browse and select text. Expanding restores annotations at their current positions and retains unsent
comment and reply text. Drag the toolbar handle to move it, or use arrow keys; Home and Reset toolbar position
restore its default. The inbox and future dockable panels share mouse/touch side switching and per-panel saved sides.
Collapse is remembered for the tab across navigation and reload; the inbox retains
its state, and **Show on page** expands the toolbar to open the requested comment.

The production URL of the toolbar is **`https://uier.io/toolbar.js`**. A reviewed site embeds it with its
project's script tag from the app's install guide:

```html
<script src="https://uier.io/toolbar.js" data-uier-project="<project code>" defer></script>
```

and the toolbar starts on its pages opened with a review link, `?toolbar-code=<project code>` (the links the app
gives out) or `?review=true` (review mode, the default; options in
[`packages/toolbar/README.md`](packages/toolbar/README.md#embedding)). The link only starts the review: the
project whose comments apply is the script's `data-uier-project`, so `?review=true` on a project's site reviews
that project too, "View project" included. It calls the API on the origin of its own script URL, so a preview
deployment's landing page talks to that preview's API.

`pnpm build` in `apps/web` first copies the production bundle of `@uier/toolbar` (a workspace devDependency,
built before the web app through Turborepo's `^build`) to `apps/web/public/toolbar.js`
([`scripts/copy-toolbar.mjs`](apps/web/scripts/copy-toolbar.mjs); the copy is gitignored and a Turborepo build
output). It refuses to copy a development build. [`next.config.ts`](apps/web/next.config.ts) serves it with
`Content-Type: application/javascript`, `Cache-Control: public, max-age=300, s-maxage=3600` and
`Access-Control-Allow-Origin: *`. Vercel builds through Turborepo as well (`buildCommand` in
[`apps/web/vercel.json`](apps/web/vercel.json)), so `vercel build` produces it too, and every deployment of the
website ships the toolbar built from the same commit.

**Caching and updates.** The bundle is a static file of the deployment, served by Vercel's CDN (compressed, with
an `ETag`). The URL is not versioned, so it is cached briefly and never `immutable`:

- The CDN keeps it for up to an hour (`s-maxage=3600`). Its cache key includes the deployment, so a new
  production deployment serves its own bundle from the first request (`x-vercel-cache: MISS`, then `HIT`); no
  purge is needed. A rollback (promoting an earlier deployment) serves that deployment's bundle the same way.
- Browsers reuse their copy for up to 5 minutes (`max-age=300`), then revalidate with `If-None-Match` and get a
  `304` while the bundle is unchanged. A release reaches every visitor within 5 minutes of the deploy
  (other shared caches on the way may keep it for up to an hour).

Every reviewed site always runs the latest toolbar; there are no pinned versions yet.

**On other sites** the toolbar needs a project: with the project's script tag (`data-uier-project`, from the
app's install guide) it uses the [review API](#review-api-a-projects-toolbar), which answers CORS for the
project's own addresses and identifies reviewers with headers instead of cookies. BotID verification runs
in a frame on uier's origin. [`embed.spec.ts`](apps/web/e2e/embed.spec.ts) checks listing, posting and
replying from another site without cookies; [`project-review.spec.ts`](apps/web/e2e/project-review.spec.ts)
checks permissions and the install guide's CSP. An embed without `data-uier-project` is for uier's own
same-origin showcase only. Failed comment loads show a message and a retry action.

### Comments API

[`apps/web/app/api/comments`](apps/web/app/api/comments), implemented in
[`apps/web/src/lib/comments`](apps/web/src/lib/comments). JSON in and out; comments are partitioned by the
public project (`project:uier00000001`, the Cosmos DB partition key `domain`) and stored per page path (without query string and
trailing slash).

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/comments?path=/x` | | `200` comments of the page, newest first (max. 200 and 1 MB), resolved ones included (`resolved: true`) |
| `GET /api/comments?scope=site` | | `200` comments of every page of the domain, newest first, with the same limits (the toolbar's inbox) |
| `POST /api/comments` | `{ path, position, kind?, text, quotedText?, device?, screenshot? }` | `201` the new comment, with `screenshot: { width, height }` when it has one (see [Screenshots](#screenshots)). `kind` is `comment` (default; `position` is a point or a text selection), `rewrite` (a suggested replacement for selected text: `position` is a text selection, `text` the suggested text, `quotedText` the original), or `feedback` / `bug` with `position: { "type": "page" }` (about the page, no pin) |
| `POST /api/comments/{id}/replies` | `{ text }` | `201` the updated comment; anyone may reply |
| `PATCH /api/comments/{id}/replies/{itemId}` | `{ text, expectedText }` | `200` the updated thread; the message's author only. Includes the first message. A stale edit gets `409` and does not overwrite newer text |
| `PATCH /api/comments/{id}/anchor` | `{ path, position, expectedRevision }` | `200` updated thread; author only, exact saved page and validated element/text selector. `expectedRevision` is `anchorContext.revision` or `null`; stale anchors return `409` |
| `PATCH /api/comments/{id}` | `{ resolved }` | `200` the updated comment; author only |
| `GET /api/comments/{id}/screenshot` | | `200` the comment's screenshot (`image/webp`, `image/jpeg` or `image/png`), public like the comment; `404` when it has none |
| `POST /api/comments/{id}/screenshot` | `{ screenshot, expectedRevision }` | `200` updated comment; author only. `expectedRevision` is the current image revision, or `null` for an original/missing image; stale evidence returns `409` |
| `DELETE /api/comments/{id}` | | Deletes the first item; author only. `204` when the comment is gone, or `200` with the comment when other visitors replied (see below) |
| `DELETE /api/comments/{id}/replies/{itemId}` | | `200` the updated comment; author of the reply only. The first item is deleted as with `DELETE /api/comments/{id}`; `204` when the comment is gone |
| `GET /api/visitor` | | `200` `{ name }`: the visitor's guest name, `null` before their first write (the toolbar's profile) |
| `DELETE /api/visitor` | | `204`; signs out: removes the `uier_visitor` cookie (never creates one) |
| `POST /api/rewrite` | `{ text, instruction? }` | `200` `{ suggestions }`: up to 3 rewrites of selected page text, none when the model declines (see [Rewrite suggestions](#rewrite-suggestions)); `503 unavailable` without an API key or when the model can't be reached; never sets the visitor cookie |

**Public ids.** Every new comment gets a `number`, counted per domain (per project for a project's comments)
from 1 and shown as `#12` in the toolbar and the app. One sequence document per partition (`type: 'sequence'`,
id `$sequence_comments`, which no route accepts, no `path` and no `ttl` of its own) is incremented atomically
when a comment is created. Numbers are not reused while the sequence document exists. When it is gone (the
preview container expires idle items, or it was deleted), numbering continues after the highest number still
stored, so a deleted comment's number can come back. Numbers count every comment, private and deleted ones
included, so gaps are normal; comments from before numbering have none.

**Deleting.** One visitor can't delete what others wrote:

- The first item, when other visitors replied: the thread stays. The item becomes a placeholder,
  `{ "id", "deleted": true, "createdAt" }`, shown as "Comment deleted"; its text and quoted text are removed
  from the database, not just hidden, and so are the comment's author and device details. Position, resolved
  state and every reply (the author's own included) stay, and anyone can still reply. Without an author nobody
  can resolve, reopen or delete the thread any more (`isMine` is `false`, `403`).
- The first item, without other visitors' replies: the whole comment is deleted, with the author's own replies.
- A reply: removed. When only the placeholder would be left, the whole comment is deleted (`204`).

Every write applies only to the version of the comment it was decided on (Cosmos DB `If-Match` on the `_etag`,
a version check in the in-memory store) and is retried on a conflict, so a reply that arrives while the author
deletes is either kept (the thread stays) or rejected with `404`, never lost or brought back.

Errors are `{ "error": "<code>", "message": "..." }`: `400 invalid_request`, `403 forbidden` (not the
author, or a cross-site request), `403 bot_detected`, `404 not_found`, `409 conflict` (retry), `413 too_large`,
`415 unsupported_media_type` (writes must be `application/json`), `429 rate_limited` (with `Retry-After` in
seconds and `reason`: `too_fast` or `page_full`), `500 server_error` and `503 unavailable` (rewrite suggestions only). Writes are accepted only from the API's
own origin (a cross-site `Origin` or `Sec-Fetch-Site: cross-site` gets `403`). Unknown fields are ignored; ids,
authors and message timestamps are always set by the server (the capture-start time is explicitly from the reviewer's browser). Selectors must have the form the toolbar creates
(`#id` or `tag.class:nth-of-type(n)` joined by `>`), so a stored comment can't break `querySelector` in
visitors' browsers. Responses never contain author ids, IP hashes, the TTL or device details other than the coarse size
(`desktop`/`tablet`/`mobile`) and the viewport the comment was left from (`windowSize`, `[width, height]` in CSS
pixels, read when feedback starts), and only the size of a screenshot (the image has its own route). Texts are shown as plain text only (no markdown, no links).

The toolbar's message menu offers **Edit** for the author (also workspace admins in project reviews).
Save and Cancel keep the original author, creation time, anchor, screenshot and replies. Failed edits retain
the attempted text. A stale edit must be reviewed against the latest message before retrying; edits are marked
in the toolbar, inbox and app, including replies.

Authorized project members additionally receive `reproduction`: browser/version and OS from supported low-entropy
client hints, the original viewport and pixel ratio, the browser's capture-start timestamp and a safe reviewed-page
link. Threads, inbox entries and app cards offer expandable, copyable details. Missing/older fields say Unknown
or Unavailable. Public and guest responses keep the restricted `device` shape and omit `reproduction`, even for
the author. Links retain the stored page identity described below; review tokens and unapproved query fields are
excluded. Replies, edits and viewport changes keep the original context.

**Meaningful page state.** Projects default to pathname-only review. Admins can choose up to 12 non-sensitive query
names in Settings → Page state and enable `#/...` or `#!/...` hash routes. The shared
[`pageState.ts`](packages/toolbar/src/pageState.ts) contract (also exported as `@uier/toolbar/page-state`) normalizes
trailing slashes, percent encoding, query order and duplicate values. Hash-route prefixes are preserved so copied
links work with the site's router. Tracking, review activation and recognized credential/identity fields cannot
be selected. Values are limited to five per field, 128 characters each; emails, URLs, token-like values and common
credential hash routes are omitted. Choose only fields that never contain personal or secret values. Keys longer
than 2048 characters fall back to pathname; the public showcase keeps its existing 512-character pathname contract.

New project records have `pageStateVersion: 1`; their `path` is the canonical view key, used consistently by APIs,
queries, caches, inbox groups, app links and durable drafts. SPA push/replace, back/forward and hash changes update
the view without carrying placement controls or draft text onto another view. Old pathname records stay on the base
page and in the site inbox. The old query-string fallback applies only to legacy records, never to v1 views.
There is no bulk migration. Changing settings does not rewrite stored feedback: old view links still restore the
website URL and show saved details in the inbox if the current routing policy no longer identifies that view.
Drafts recover across reload and navigation; see [Draft recovery and submission retries](#draft-recovery-and-submission-retries).

**Anonymous identity.** The first comment or reply sets the `uier_visitor` cookie (reading comments and asking
for rewrite suggestions never do): 32 random bytes (base64url), `HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`, `Secure` everywhere
except plain http on a loopback host (local development and tests). Comments store only
`authorId = sha256(token)`, never the token. Visitors are shown as `Guest XXXX` (4 hex characters of an HMAC of
the author id with a server key, so a name can't be forged offline) and as "You" for their own items; the API
returns `isMine` / `author.isMe` so only the author sees the resolve and delete actions. Signing out in the
toolbar (`DELETE /api/visitor`) removes the cookie: the comments stay, and that browser gets a new identity with
its next write. The server key is
`UIER_COMMENTS_SECRET`, a random value Pulumi sets separately for production and previews (locally a fixed
development key); changing it changes every guest name and nothing else.

**Limits** (all in [`limits.ts`](apps/web/src/lib/comments/limits.ts)). Rate limits are fixed windows per domain,
counted atomically in small counter documents (`type: 'counter'`, id = HMAC of the subject and window, expiring
shortly after the window) in the comments container, so concurrent requests can't exceed them and comments
carry no IP-derived data:

| Limit | Value |
| --- | --- |
| Request body | 16 KB (`413`); a new comment with a screenshot about 700 KB |
| Screenshots | PNG, JPEG or WebP, 512 KB and 4096 px on a side; 300 per domain or project per day |
| Comment / reply text | 1-1000 characters after trimming, at least one visible character; bidirectional override characters are removed; quoted text up to 1000 |
| Path / selectors / selected text | 512 / 1024 / 2000 characters |
| Thread | 50 messages (replies are appended atomically) |
| New comments per visitor | 10 per hour |
| Replies per visitor | 30 per hour |
| Writes per IP (an IPv4 address or an IPv6 /64) | 30 per hour |
| New comments per page | 100 per day (`reason: page_full`) |
| Rewrite suggestions | 20 per visitor (with the cookie) or project reviewer per hour, 300 per domain or project per day; app-wide, whatever the site: 40 per IP per hour and 1000 per day; selected text and each suggestion up to 1000 characters (what a rewrite comment holds), instruction up to 300 |

**Bot protection: [Vercel BotID](https://vercel.com/docs/botid)** (basic mode, no captcha).
[`instrumentation-client.ts`](apps/web/instrumentation-client.ts) attaches the BotID challenge to the page's
same-origin `POST`/`PATCH`/`DELETE` requests to `/api/comments*` (and `POST /api/rewrite`), and every write handler calls `checkBotId()`
first (`403 bot_detected` for bots). `withBotId` in `next.config.ts` proxies BotID's scripts through this origin,
so the CSP needs no changes. BotID verifies every write except when the app runs locally: `next dev`, or
`UIER_LOCAL=1` (set by `playwright.config.ts` for `next start`; never set it on a deployment). Locally every
request is treated as human and `UIER_BOTID_DEV_BYPASS=BAD-BOT` simulates a bot to test the `bot_detected`
path. Anything else fails closed: a deployment where BotID can't verify (for example without the project's OIDC
token) rejects writes with `500`.

**Retention.** Starter threads (`comment_uier_headline`, `comment_uier_first_step`) and their replies
never expire (`ttl: -1`). New visitor threads in the `comments` container carry a Cosmos DB per-item `ttl`: they expire **90 days**
after their last change. The container has `defaultTtl: -1` (TTL enabled, nothing expires without its own
`ttl`). New visitor threads in `comments-preview` have no per-item `ttl` and expire with the container default (7 days).

**Storage.**

| Environment | Store |
| --- | --- |
| Vercel production | Cosmos DB container `comments` (account key: `COSMOSDB_CONNECTION_STRING`, `COSMOSDB_COMMENTS_CONTAINER=comments`) |
| Vercel preview (pull requests) | Cosmos DB container `comments-preview` in the same database (`defaultTtl` 7 days), no account key: Microsoft Entra ID with the deployment's Vercel OIDC token (`COSMOSDB_ENDPOINT`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `COSMOSDB_COMMENTS_CONTAINER=comments-preview`) |
| Local development, e2e tests | In memory, when neither `COSMOSDB_CONNECTION_STRING` nor `COSMOSDB_ENDPOINT` is set (`next dev`, or `UIER_LOCAL=1`) |

Outside local development a missing Cosmos DB configuration or `UIER_COMMENTS_SECRET` is an error (`500`), never
a silent in-memory store. The preview variables exist once `pulumi up` has run on `main`, so the comments API of
a preview deployed before that returns `500`.

Previews can't reach production comments. They get no account key: they authenticate as a user-assigned
managed identity that trusts only the OIDC token of this Vercel project's preview deployments, and its only
Cosmos DB role (the built-in Data Contributor) is scoped to the `comments-preview` container. Any other
container answers `403`, whatever `COSMOSDB_COMMENTS_CONTAINER` says. The trust follows the token's claims
(team issuer `https://oidc.vercel.com/signalco`, subject `owner:signalco:project:uier:environment:preview`):
renaming the Vercel team or project, or switching the project to the global issuer, stops preview access until
[`infra/src/index.ts`](infra/src/index.ts) is updated.

`COSMOSDB_COMMENTS_CONTAINER` selects the container (default `comments`). All of these variables are managed by
Pulumi (see [Infrastructure](#infrastructure)).

### Screenshots

Every new element/text comment, rewrite, feedback and bug report starts a screenshot automatically
([#81](https://github.com/signalco-io/uier/issues/81)). There is no capture button or image preview in the composer.
Submitting waits for the capture attempt, with a 15-second limit; failures keep the text and show an unavailable
image state on saved feedback. Image-capacity or image-storage failures also preserve the text. Images are saved only with successfully posted feedback. Replies keep the original
capture. Saved inbox entries and comment details show thumbnails that expand on click, tap or keyboard activation.

The toolbar draws the capture in the reviewer's browser
([`packages/toolbar/src/screenshot.ts`](packages/toolbar/src/screenshot.ts), with
[`modern-screenshot`](https://github.com/qq15725/modern-screenshot)), without the toolbar or inline review threads,
cut to the element/text with some room around it (the window for page feedback), as WebP (JPEG where unavailable)
of at most 480 KB.
Images, fonts and stylesheets from other sites that don't allow it (CORS, or the site's CSP `connect-src`),
images that haven't loaded within a second (lazy ones below the window), `<canvas>`, video, iframes and
`backdrop-filter` come out empty or plain.

For missing or unsuitable captures, the author (or a workspace admin) can choose **Upload image** or
**Paste image** on saved feedback in the toolbar. Keyboard image paste also works while a saved image
control has focus. PNG, JPEG and WebP images use the same 512 KB / 4096 px limits as automatic evidence;
invalid images and denied clipboard access show an error and keep the saved feedback. Nothing is previewed
in a composer. Images are not persisted with drafts or in browser storage.

Expand the saved thumbnail and choose **Redact screenshot** to cover content with opaque black rectangles.
Drag with a mouse/touch, or enter left/top/width/height percentages and add an area using the keyboard.
Undo and cancel affect only the editor. **Save redaction** flattens the masks into a replacement image.
Upload, paste and redaction all use an authorized, conditional transaction that swaps the image and comment
metadata together. The previous bytes remain until success, then are overwritten in the same storage document;
the API exposes no image history. Failed or unconfirmed saves report an error; reload to check an uncertain
network result. Image revisions prevent stale replacements. These actions count against the existing daily
image budget. They cannot erase copies someone already downloaded.

It is sent with `POST /api/comments` (or the review API) as `screenshot`, a data URL; the body of a new comment
may then be up to about 700 KB. The server reads the type and size from the image itself (PNG, JPEG or WebP, at
most 512 KB and 4096 px on a side) and stores it as a document of its own in the comment's partition
(`type: 'screenshot'`, id `$screenshot_<comment id>`, which no route accepts, with the comment's `ttl`); the comment
keeps `screenshot: { contentType, width, height, bytes, revision? }`. Anyone who can see the comment gets the image from
`GET .../comments/<id>/screenshot` (the toolbar fetches it when the thread shows it, in the inbox as it scrolls into view); the app shows it on the comment
(`/app/projects/<project>/comments/<id>/screenshot`). It is deleted with the comment, or with its author's text
when others replied. A site gets at most 300 screenshots a day.

### Rewrite suggestions

The toolbar's **Rewrite** action (selected text) can ask for AI suggestions: `POST /api/rewrite` (a project's
toolbar: `POST /api/review/<code>/rewrite`) ([`src/lib/rewrite/suggest.ts`](apps/web/src/lib/rewrite/suggest.ts)) calls the Anthropic API with the official
SDK: model `claude-opus-5-5` at `low` effort, a JSON schema for the answer (`{ suggestions: string[] }`), and the
server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), which retries a
request a safety classifier declines on Anthropic's recommended model. The selected text and the instruction are
treated as content, never as instructions. Each call has `max_tokens: 4096` and a hard 1000-character limit per
suggestion in its prompt; longer suggestions, duplicates and the original are left out, never cut. A request the
model still declines gives no suggestions (`200`, the toolbar says "No suggestions for this text."); a failure, or
no answer within 45 seconds (both attempts), is `503 unavailable`. The limits (above) are checked before the model
is called: per visitor and per site or project, and app-wide per IP and per day (counters in the `app`
partition), so more sites or projects never add up to more. Nothing about a request is stored and no cookie is
set; a suggestion the reviewer posts is saved as a comment with `kind: "rewrite"` (its text is the suggested
text, `quotedText` the original).

The SDK reads `ANTHROPIC_API_KEY`. In production Pulumi sets it from the repository secret `ANTHROPIC_API_KEY`
(the Pulumi workflow passes it in like the Vercel and Cloudflare tokens); without the secret no variable is
created. Previews and local development have no key: the endpoint answers `503 unavailable` and the toolbar says
suggestions are not available, while the reviewer's own rewrite still works. Set `ANTHROPIC_API_KEY` in
`apps/web/.env.local` to try them locally. The e2e tests point the app at a stand-in for the API
([`e2e/support/anthropicStub.ts`](apps/web/e2e/support/anthropicStub.ts), started by `playwright.config.ts` on
`PORT + 1000`), which checks each request and answers with canned suggestions.

### Removing abusive comments

There is no moderation UI yet. Remove comments directly in Cosmos DB:

1. Azure portal -> resource group `uier-production8b2f56d6` -> Azure Cosmos DB account `uierdb...` ->
   **Data Explorer** -> database `uierdata` -> container `comments` (`comments-preview` for preview deployments).
2. **New SQL Query**, e.g. all comments of the landing page:

   ```sql
   SELECT * FROM c WHERE c.domain = 'uier.io' AND c.path = '/' ORDER BY c._ts DESC
   ```

   (`domain` is the host the comment was posted on, e.g. `uier.io`; other useful filters:
   `CONTAINS(c.thread.items[0].text, 'spam')`, `c.authorId = '<authorId of a known abusive comment>'`.
   Rate-limit counters are in the same container (`c.type = 'counter'`, no `path`) and expire by themselves.
   So is each partition's comment numbers' sequence (`c.type = 'sequence'`, id `$sequence_comments`): do not
   delete it, or numbering continues after the highest number still stored. A comment's screenshot is a
   document of its own (`c.type = 'screenshot'`, id `$screenshot_<comment id>`): delete it with the comment.)
3. Open the document and **Delete** it to remove the whole comment, or remove the offending entry from
   `thread.items` and **Update** to remove a single reply. If only a deleted first item (`deletedAt`) would be
   left, delete the document instead. Changes are visible immediately (the API does not cache).

## Status

[uier.io/status](https://uier.io/status) and `GET /api/status` show the live state of the services, checked on the
server when they are requested ([`src/lib/status`](apps/web/src/lib/status/serviceStatus.ts)):

| Service | Check |
| --- | --- |
| Website | none: it answers, so it is up |
| Comments | the comments server key is configured and a point read of a missing document in the comments store answers within 5 s (about 1 RU on Cosmos DB) |

Results are reused for 30 seconds per server instance. `/api/status` returns the report as JSON with `200` when
every service is operational and `503` otherwise (`Cache-Control: no-store`), so an external monitor can poll it.
Nothing is recorded: there is no history or uptime figure, and none is claimed. A failed check is logged as
`[status] Comments API check failed` with the error. If uier.io itself is down, the status page is down too.

## Infrastructure

[`infra/`](infra) is the Pulumi project **`uier`** (Node.js runtime) with a single stack,
**`organization/uier/uier-production`**. It manages:

- the Vercel project **`uier`** (`prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc`, root directory `apps/web`, Node.js 24,
  function region `dub1`), its domains `uier.io` and `www.uier.io` (a permanent `308` redirect to `uier.io`
  that keeps the path and query) and the comments API variables: production gets `COSMOSDB_CONNECTION_STRING`
  (the Cosmos DB account's primary key) and `COSMOSDB_COMMENTS_CONTAINER=comments`, preview gets
  `COSMOSDB_ENDPOINT`, `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` (the managed identity below) and
  `COSMOSDB_COMMENTS_CONTAINER=comments-preview`, and each gets its own random `UIER_COMMENTS_SECRET`.
  The app's data container is `COSMOSDB_APP_CONTAINER` (`app` / `app-preview`); only production gets the
  email variables `ACS_CONNECTION_STRING` and `UIER_EMAIL_SENDER`, and `ANTHROPIC_API_KEY` (rewrite
  suggestions) once the repository secret `ANTHROPIC_API_KEY` is set,
- the Cloudflare DNS records for `uier.io` (`A 76.76.21.21`) and `www.uier.io` (`CNAME cname.vercel-dns.com`),
  both DNS only (not proxied), so Vercel terminates TLS and renews the Let's Encrypt certificates itself,
- the Azure resource group `uier-production8b2f56d6` (Pulumi logical name `uier-production`) with a
  serverless Cosmos DB account (database `uierdata`, containers `comments` with per-item TTL enabled
  (`defaultTtl: -1`) and `comments-preview` (`defaultTtl` 7 days), both partitioned by `/domain`; the app's
  `app` (`defaultTtl: -1`) and `app-preview` (`defaultTtl` 7 days), both partitioned by `/pk`) and the
  user-assigned managed identity `uier-preview-cosmos...` of preview deployments: a federated identity
  credential for the Vercel OIDC token of the project's preview deployments and Cosmos DB data plane role
  assignments (built-in Data Contributor) on the `comments-preview` and `app-preview` containers,
- Azure Communication Services Email for the app's sign-in links and invitations (`infra/src/email.ts`): an
  email service with an **Azure-managed sender domain** (`DoNotReply@<id>.azurecomm.net`), linked to a
  communication service. Unlike a `uier.io` domain it needs no DNS records and no manual verification before
  it can be linked, so one `pulumi up` gives a working sender; its sending limits are low. Moving to a
  verified `uier.io` sender needs its DNS records and a one-time verification in the Azure portal first.

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
| [`vercel-deploy_reusable.yml`](.github/workflows/vercel-deploy_reusable.yml) | called | `vercel pull`, `vercel build`, `vercel deploy --prebuilt --archive=tgz` (reduces file uploads). |

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
| `ANTHROPIC_API_KEY` | Optional: production's `ANTHROPIC_API_KEY` on Vercel (rewrite suggestions), set by Pulumi; until it is set suggestions are not available |

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

Contributor on the resource group also covers the preview managed identity, its federated credential and the
Cosmos DB data plane role assignment (`Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/write` is a
Cosmos DB control plane action, not a `Microsoft.Authorization` one, which Contributor excludes).

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

See [CONTRIBUTING.md](CONTRIBUTING.md): pull requests against `main`, [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore(deps):` ...), and `pnpm typecheck && pnpm build && pnpm test` before you push. Report security
problems as described in [SECURITY.md](SECURITY.md), not in an issue.

## History

This code was split out of the [signalco-io/signalco](https://github.com/signalco-io/signalco) monorepo
with its git history preserved (`web/apps/uier` -> `apps/web`, `web/packages/uier-toolbar` -> `packages/toolbar`,
`infra/apps/uier` -> `infra`). Issue and pull request references in older commit messages
(`signalco-io/signalco#1234`) point to the original repository.

## License

[`apps/web`](apps/web) is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
[`packages/toolbar`](packages/toolbar) and [`infra`](infra) are licensed under the MIT license, as declared in their
`package.json`. Anything without an explicit license is covered by the root [LICENSE](LICENSE) (AGPL-3.0).
[uier.io/open-source](https://uier.io/open-source) explains the licenses in plain words; keep it in step with this section.

### Draft recovery and submission retries

The toolbar keeps unsent comment, rewrite, page feedback, bug, reply and edit text in the reviewed
site's local storage for seven days after the last change. Versioned `uier:draft:v1:` keys include
the API, project, server-authorized reviewer scope, canonical page key (`@uier/toolbar/page-state`)
and thread/item. Pinned drafts retain their element/text anchor and return as closed pins without taking focus; edits retain the original text
for stale-edit protection. Closing a composer keeps its draft. Discard (Cancel for edits), a
successful submission and toolbar sign-out remove it; sign-out clears that reviewer's project
drafts on every page of the current site. Drafts on another reviewed origin must be cleared there.
Expired drafts are ignored and pruned when the toolbar next opens. Browser/site scripts can read
local storage: do not type secrets into feedback. If storage is blocked or full, the draft stays
in memory and the composer explains that the page must stay open.

Images and device details are never persisted with drafts. Automatic capture is refreshed on
reopen/reload, using the restored anchor and the current page/viewport. Capture uses the resolved anchor
when available; failed capture never blocks text. Composers show no image preview.
Saved screenshots keep their expandable thumbnail behavior.

Create/reply requests from the toolbar carry a random `idempotencyKey`, kept with the draft.
Unchanged retries keep it, including after reload; changing the submitted text/anchor/kind starts
a new attempt. Pending sends share a lock across composer instances. This is recovery of authored
work, with an explicit send action, not a background queue. Both comments APIs accept optional
keys (16–128 URL-safe characters). Receipts are scoped to the server actor and partition, shared
across create/reply operations, and reject conflicting content with 409. Capture/device changes
are excluded from the content hash so restored captures do not invalidate a retry. A replay
returns the current authorized thread, including later edits; a deleted thread returns 404 and
is never resurrected. Receipts contain hashes and ids only, expire after 30 days, and are committed
atomically with the comment/reply and optional screenshot (Cosmos single-partition batch,
conditional replacement for replies). No live Cosmos transaction is exercised by local tests.

On the public toolbar a random visitor token is kept in memory until a draft is started, then
stored as `uier:visitor`. The first successful write still sets the HttpOnly cookie. A validated
`X-Uier-Visitor` token supplies the same identity when that first write's response/cookie is lost;
an existing cookie always takes precedence. Toolbar sign-out removes both identities.

### Unread review activity

The toolbar's blue badge counts unread threads across all of the site's authorized comments. Open/Done
counts remain separate. The Unread filter includes all statuses and pages. Opening a visible short
thread acknowledges it after 800 ms in a focused foreground window; inbox previews and longer
collapsed threads require **Mark as read**. Reading never resolves feedback, and resolving never
acknowledges it. The app shares the same member cursor and offers Unread / Mark as read.

One scheduler refreshes active page/site queries every 15 seconds while expanded, online and visible,
and immediately on focus, reconnect, foreground return and expansion. Hidden and collapsed reviews
do not poll. Content lists retain their size limits; a separate activity projection supplies full badge/status
counts. The Unread filter fetches unread content before applying those limits, so older unread threads
remain findable. Marking a batch read reveals the next batch. The inbox warns when content is omitted. Fresh requests enforce project/private permissions and access failures purge cached
comments and screenshots. Drafts, stable thread keys and focus survive ordinary refreshes.

`apps/web/src/lib/comments/activity.ts` defines the monotonic thread activity sequence. Creation,
replies, resolve/reopen, assignment changes and newly selected mention recipients advance it
atomically with the thread write. Reads and edits retaining the same recipients do not.
Actor ids stay server-side. DTO `activity` contains `sequence`, `lastOtherSequence`, `readSequence`
and `unread` (`lastOtherSequence > readSequence`). Own posts do not create unread or clear another
person's unread activity. Legacy threads derive a stable initial sequence from stored item order.

`POST /api/review/:projectId/comments/:id/read` accepts `{ sequence }` and returns the activity DTO.
It uses the existing project and private-thread access checks and authenticated actor; callers cannot
choose another reviewer. It acknowledges only the rendered sequence, rejects a future sequence, and
uses etags and `max()` across concurrent tabs. The public showcase uses `/api/comments/:id/read`.
Receipts are `review-read` documents in the existing app container, partitioned by domain/reviewer;
members use `user:<id>` across sites/devices, guests the existing hashed browser/site visitor id.
Guest receipts expire one year after the last advancing acknowledgement; member receipts persist.
Project guests fall back to page memory when local storage is blocked. Public guests can retain
their identity in the visitor cookie. Read tracking introduces no additional browser storage key.

For notification seen suppression (#84), recheck current project access and private-thread visibility,
then call `getReadSequence(domain, reviewerId, commentId)` from `comments/readState.ts` and compare the
queued activity's sequence. The read service sends no email and stores no delivery queue. Assignment
and mention producers advance `withThreadActivity` inside the same conditional write as their
authorized mutation and record recipients through the shared notification outbox.

`GET .../comments/activity` returns authorized `{ unread, open, done, total }` counts without message
text or actor ids. `GET .../comments?scope=site&unread=true` selects unread threads from the full
activity projection before fetching a bounded content batch. Both use the same private/access checks.

### Missing anchors and reattachment

Thread details distinguish exact positions, uniquely restored text, temporarily hidden targets, missing
targets and ambiguous matches. Text with several possible matches is never silently moved to the first.
Missing/ambiguous/hidden targets have no page pin; comments remain searchable/reachable in the inbox.
Authors and workspace admins can choose a new element or text on the same saved page and confirm or
cancel. Pointer/touch and keyboard element selection are supported. The existing dockable panel and
movable toolbar retain their positions; collapse cancels selection and hides page annotations.

Reattachment updates only the position and `anchorContext` (original and immediately previous anchors,
last change time, count and revision). Messages, original quotes, screenshots, authors and status stay
unchanged. Context has the same visibility and retention as its comment; no new browser storage or
external processing is added. Server checks enforce partition/project, author/admin permission, saved
page key, original allowed origin and existing selector/offset limits. ETag retries retain concurrent
replies/status changes and recheck authorization; anchor revisions reject stale choices. No cross-page
migration or AI relocation is provided.

### Copy feedback as an issue

Saved thread details in the toolbar and app offer **Copy issue**: exact saved feedback, quotes,
anchor, permitted links, original permitted browser context, discussion and protected screenshot
references in one Markdown packet. Clipboard failures offer selectable Markdown. This is an explicit
export; it does not publish to a tracker. The shared versioned model and access rules are documented
in [Feedback context](docs/feedback-context.md).

### Coding tool access (MCP)

In **Account → Coding agents**, give a credential a name, select up to 20 projects in the current
workspace, and choose operations. Read feedback is selected initially; screenshots, replies,
status changes and assignments each need an explicit scope. The app issues a 30-day credential,
shows the secret once, and lets its owner revoke it from any workspace. Store it outside source
control in the environment of your chosen client. Only a SHA-256 hash and the grant metadata are
stored. Removal of membership/project access and private visibility changes apply on the next
request. Public project codes, guest ids, review links and app cookies cannot authorize MCP.

The endpoint is `https://uier.io/api/mcp` (use your local/preview origin while testing). It uses the
[official TypeScript SDK's Streamable HTTP transport](https://ts.sdk.modelcontextprotocol.io/server),
stateless JSON responses, and a manually configured `Authorization: Bearer <credential>` header.
OAuth login/discovery and clients that require OAuth are not supported. For a compatible Codex
client, set `UIER_MCP_TOKEN` in its environment and add this to the client's configuration:

```toml
[mcp_servers.uier]
url = "https://uier.io/api/mcp"
bearer_token_env_var = "UIER_MCP_TOKEN"
```

[Codex documents this environment-based bearer configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers).
The credential belongs to the named human account. It grants no additional project or private
feedback rights. Its selected projects do not expand when new projects are created.

| Tool | Scope | Behavior |
| --- | --- | --- |
| `list_projects` | `feedback:read` | Selected projects still accessible to the owner |
| `list_feedback` | `feedback:read` | Visible feedback search and status filter within the latest 1000 threads |
| `get_feedback` | `feedback:read` | Thread, anchor, original reproduction context and authorized screenshot reference |
| `list_assignees` | `feedback:assign` | Existing participants eligible to see the thread |
| `reply_to_feedback` | `feedback:reply` | Validated reply as the human account, labeled with the credential name |
| `set_feedback_status` | `feedback:status` | Resolve/reopen using the app's permission checks |
| `assign_feedback` | `feedback:assign` | Assign an existing authorized participant, or `null` to unassign |

`get_feedback` returns `{ actingAs, contentTrust, context, markdown, screenshotResource? }`.
`context` and `markdown` come directly from the same authorized project export service as Copy
issue, using the shared [version 1 feedback context contract](docs/feedback-context.md). The MCP
resource reference supplements its protected web image link when image access was granted.
Deleted first-message evidence is unavailable through both the packet and screenshot resource.

Screenshot references are `uier://projects/{projectId}/feedback/{commentId}/screenshot` resources.
Use MCP `resources/read` with `screenshots:read` to retrieve the saved image; current feedback
visibility is checked again. References never contain a credential or create a public image URL.
Clients control whether images/text they retrieve are sent to their own model provider. Revoking
access cannot retract data already received by a client.

Responses mark feedback as `contentTrust: "untrusted"`; server instructions also identify text,
anchors, names and images as untrusted content. Clients must treat them as data and keep changes
user-initiated. The connector cannot edit code, run commands or deploy. A supported workflow is:
ask the client to read selected feedback, approve a code fix in the coding tool, then explicitly
approve its reply and status update. Tool annotations identify reads and mutations, but annotations
are hints, not an approval system. Reading does not acknowledge inbox unread activity.

List tools accept `limit` (1–25, default 20) and numeric `cursor` (default 0), returning `nextCursor`
or `null`. Cursors are offsets in current results, so concurrent additions can shift a page. Search
is bounded to the latest 1000 threads; use known ids to read older feedback. Requests are limited
to 16 KiB and 120 per user per minute. Thread/image sizes retain existing review validation limits.
No server sessions or long-running streams are retained; GET/DELETE return 405 after authentication.

Every mutation requires an `idempotencyKey` (16–128 letters, numbers, `_` or `-`). Generate one per
intended action and reuse the same key and exact input after a timeout. Atomic 30-day receipts
prevent duplicate replies and prevent old status/assignment retries from overwriting subsequent
changes. Reusing a key with different input returns a conflict. Do not retry an old intention with
a new key automatically; confirm it with the user again. Tool errors include stable error codes;
rate limits include retry guidance. Credential errors return HTTP 401, invalid origins HTTP 403.
Replies retain the human author and credential attribution; status/assignment outbox events retain
the same attribution and use existing unread and notification rules. No notification bypass is added.

`e2e/mcp.api.spec.ts` uses the official SDK client for the read/fix/reply/status path and adversarial
isolation, image, expiry, revocation, membership and retry checks. `e2e/mcp.spec.ts` connects that
client to a credential created in the real Account UI, verifies light/dark accessibility and revokes
access on the existing connection. This feature does not close the separate MVP launch audit #90.
