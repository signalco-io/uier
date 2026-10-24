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
- On every other page it runs in **review** mode and mounts only when the page is opened with a review link
  (`?toolbar-code=<project code>` or `?review=true`, e.g. http://localhost:4004/brand?review=true); the review
  then continues in that tab until "Exit review".
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

The tests start their own server on port 4004. To use another port, for example to run them in two worktrees
at once or while `pnpm dev` holds 4004, set `PORT`:

```bash
PORT=4104 pnpm test
```

Outside CI, a server that already answers on that port is reused rather than started, so stop `pnpm dev` or
pick a free port to test the production build.

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
  reopened projects, project settings, billing and the account page, with axe checks on every page.
- **API** - [`comments.api.spec.ts`](apps/web/e2e/comments.api.spec.ts): the comments API with separate
  request contexts as separate visitors (ownership, deleting threads others replied to, validation, `413`,
  path filtering, DTO contents, cookie flags, rate limits).
- **Desktop Chrome** and **Mobile Chrome** - the landing page (render, security headers, axe, `/toolbar.js`)
  and the showcase toolbar ([`showcase.spec.ts`](apps/web/e2e/showcase.spec.ts)): point and text-selection
  comments (the hover outline, the thread that opens after posting; text anchors, restored highlights, fallback
  pins and the viewport are in [`anchors.spec.ts`](apps/web/e2e/anchors.spec.ts)), a second visitor who can reply but not
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

- **Sign in** (`/app/sign-in`): no passwords. The app emails a single-use link (valid for 15 minutes, stored
  only as a SHA-256 hash); the first sign-in creates the account. Opening the link shows a "Continue"
  button, because email scanners open links before people do. The session is an HttpOnly `uier_session`
  cookie with a signed token (30 days; the key is derived from the server secret, like the guest names).
  Sign-in emails are limited to 5 per address and 20 per IP per hour. Signed-out visits to an app page go
  to sign in and come back afterwards (`proxy.ts`, `?next=`).
- **Workspaces**: every user gets a workspace of their own on first sign-in and is its admin. Projects and
  members belong to a workspace; with more than one workspace the account menu switches between them.
- **Projects** (`/app/projects`): one project per reviewed site, with its addresses (the main site first,
  then staging or preview addresses), its status (active or done) and who can comment. The project code
  (12 lowercase letters and digits) is public: it is in the embed script.
  - Onboarding: `/app/projects/new` (the addresses), then the install guide `/app/projects/<code>/install`
    (the script, where to paste it on common platforms, and the CSP sources in "Advanced").
  - Details `/app/projects/<code>`: review links for every address, the guest link (in guest mode) and the
    project's **comments**, as a list or a board (Open / Done), filtered by people (all, assigned to me,
    opened by me) and page (relative URLs). Each comment shows its page URL, the device size it came from,
    when it was created, its author, assignee, replies and state, with Done, Link to comment and Assign;
    the author or an admin edits and deletes it, and only admins make it private.
  - Settings `/app/projects/<code>/settings`: who can comment (invited people, anyone with the link, or
    comments off), addresses, project code and embed script, usage (comments, open, done, replies, pages,
    people with access), name, done.
  - Review links `/app/review/<code>?url=<page>&comment=<id>` check access and redirect to the page with the
    toolbar's review link parameter `?toolbar-code=<code>`, a single-use code that signs the toolbar in
    (`uier-token`) and the comment to open (`uier-comment`); only addresses of the project are redirect
    targets.
- **Users** (`/app/users`, admins only): the people in the workspace with their role (admin or commenter)
  and the projects they review, filtered by project (`?project=`), and the pending invitations. Admins
  delete people (the last admin stays) and revoke invitations. A deleted member's review token stops
  working at once, because the review API checks the membership on every request.
  - Invite `/app/users/invite` (also "Invite" on a project): the email, the role and, for commenters, the
    selected projects or all projects. The email links to `/app/invitation?token=` (single use, 7 days,
    stored only as a SHA-256 hash; 50 invitations per workspace per day). Inviting the same address again
    replaces the earlier invitation. Accepting takes a click, like signing in: it signs the invited person
    in (their account is created on first use), adds them to the workspace and opens the project's review
    link, or the projects when the invitation has no project.
- **Billing** (`/app/billing`): the pricing promise `brand.pricing`, word for word like the landing page:
  every feature available today is free and stays free.

### Review API (a project's toolbar)

A project's toolbar (`data-uier-project`, see the [toolbar README](packages/toolbar/README.md)) runs on the
customer's site and calls `/api/review/<code>` on uier.io, implemented in
[`apps/web/src/lib/review`](apps/web/src/lib/review). The routes mirror the comments API:

| Request | What |
| --- | --- |
| `GET /api/review/<code>` | the project (name, who can comment), the reviewer and whether they can comment, the sign-in URL |
| `POST /api/review/<code>/session` | `{ code }`: exchanges a review link's single-use code (10 minutes) for a review token (30 days) |
| `GET`, `POST /api/review/<code>/comments` | the comments of a page (`?path=`), a new comment (`authorName` from guests) |
| `POST /api/review/<code>/comments/<id>/replies`, `PATCH`/`DELETE /api/review/<code>/comments/<id>`, `DELETE .../replies/<itemId>` | replies, done (`resolved`), deleting |

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
  the author (`user:<id>` for members) and no TTL. The same rate limits as the comments API apply; BotID
  does not (it only covers same-origin requests).

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

## Landing page showcase and public feedback

The landing page (`/`) embeds the toolbar the same way a customer site would, in **showcase** mode:

```html
<script src="/toolbar.js" data-uier-mode="showcase"></script>
```

([`ToolbarScript`](apps/web/src/components/toolbar/ToolbarScript.tsx), which renders the toolbar's React component
`<UierToolbar mode="showcase" />` from `@uier/toolbar/react`). The toolbar
is always mounted there and shows a dismissible first-run hint; anonymous visitors can leave point comments,
text-selection comments and replies. **Feedback is public**: every visitor sees every unresolved comment on
the page and can reply to it. Embedding options and the toolbar's modes are described in
[`packages/toolbar/README.md`](packages/toolbar/README.md).

### `/toolbar.js`

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
project's own addresses and identifies reviewers with headers instead of cookies
([`project-review.spec.ts`](apps/web/e2e/project-review.spec.ts)). Without a project it mounts and calls
`https://uier.io/api/comments` ([`embed.spec.ts`](apps/web/e2e/embed.spec.ts)), which does not accept
cross-origin requests: it sends no CORS headers, BotID only protects requests from the same origin and the
`uier_visitor` cookie is not sent cross-site ([#53](https://github.com/signalco-io/uier/issues/53)).

### Comments API

[`apps/web/app/api/comments`](apps/web/app/api/comments), implemented in
[`apps/web/src/lib/comments`](apps/web/src/lib/comments). JSON in and out; comments are partitioned by the
request's `Host` (the Cosmos DB partition key `domain`) and stored per page path (without query string and
trailing slash).

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/comments?path=/x` | | `200` comments of the page, newest first (max. 200 and 1 MB), resolved ones included (`resolved: true`) |
| `POST /api/comments` | `{ path, position, kind?, text, quotedText?, device? }` | `201` the new comment. `kind` is `comment` (default; `position` is a point or a text selection), or `feedback` / `bug` with `position: { "type": "page" }` (about the page, no pin) |
| `POST /api/comments/{id}/replies` | `{ text }` | `201` the updated comment; anyone may reply |
| `PATCH /api/comments/{id}` | `{ resolved }` | `200` the updated comment; author only |
| `DELETE /api/comments/{id}` | | Deletes the first item; author only. `204` when the comment is gone, or `200` with the comment when other visitors replied (see below) |
| `DELETE /api/comments/{id}/replies/{itemId}` | | `200` the updated comment; author of the reply only. The first item is deleted as with `DELETE /api/comments/{id}`; `204` when the comment is gone |
| `GET /api/visitor` | | `200` `{ name }`: the visitor's guest name, `null` before their first write (the toolbar's profile) |
| `DELETE /api/visitor` | | `204`; signs out: removes the `uier_visitor` cookie (never creates one) |

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
seconds and `reason`: `too_fast` or `page_full`) and `500 server_error`. Writes are accepted only from the API's
own origin (a cross-site `Origin` or `Sec-Fetch-Site: cross-site` gets `403`). Unknown fields are ignored; ids,
authors and timestamps are always set by the server. Selectors must have the form the toolbar creates
(`#id` or `tag.class:nth-of-type(n)` joined by `>`), so a stored comment can't break `querySelector` in
visitors' browsers. Responses never contain author ids, IP hashes, the TTL or device details other than the coarse size
(`desktop`/`tablet`/`mobile`) and the viewport the comment was left from (`windowSize`, `[width, height]` in CSS
pixels, read when it is posted). Texts are shown as plain text only (no markdown, no links).

**Anonymous identity.** The first successful write sets the `uier_visitor` cookie (reading comments never
does): 32 random bytes (base64url), `HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`, `Secure` everywhere
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
| Request body | 16 KB (`413`) |
| Comment / reply text | 1-1000 characters after trimming, at least one visible character; bidirectional override characters are removed; quoted text up to 1000 |
| Path / selectors / selected text | 512 / 1024 / 2000 characters |
| Thread | 50 messages (replies are appended atomically) |
| New comments per visitor | 10 per hour |
| Replies per visitor | 30 per hour |
| Writes per IP (an IPv4 address or an IPv6 /64) | 30 per hour |
| New comments per page | 100 per day (`reason: page_full`) |

**Bot protection: [Vercel BotID](https://vercel.com/docs/botid)** (basic mode, no captcha).
[`instrumentation-client.ts`](apps/web/instrumentation-client.ts) attaches the BotID challenge to the page's
same-origin `POST`/`PATCH`/`DELETE` requests to `/api/comments*`, and every write handler calls `checkBotId()`
first (`403 bot_detected` for bots). `withBotId` in `next.config.ts` proxies BotID's scripts through this origin,
so the CSP needs no changes. BotID verifies every write except when the app runs locally: `next dev`, or
`UIER_LOCAL=1` (set by `playwright.config.ts` for `next start`; never set it on a deployment). Locally every
request is treated as human and `UIER_BOTID_DEV_BYPASS=BAD-BOT` simulates a bot to test the `bot_detected`
path. Anything else fails closed: a deployment where BotID can't verify (for example without the project's OIDC
token) rejects writes with `500`.

**Retention.** Comments in the `comments` container carry a Cosmos DB per-item `ttl`: they expire **90 days**
after their last change. The container has `defaultTtl: -1` (TTL enabled, nothing expires without its own
`ttl`). Comments in `comments-preview` have no per-item `ttl` and expire with the container default (7 days).

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
   Rate-limit counters are in the same container (`c.type = 'counter'`, no `path`) and expire by themselves.)
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
  email variables `ACS_CONNECTION_STRING` and `UIER_EMAIL_SENDER`,
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
