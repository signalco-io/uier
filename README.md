# uier

[uier.io](https://uier.io) lets you review a live website by leaving comments directly on the page.
A small toolbar is injected into the page (inside a shadow DOM, so it neither inherits nor leaks
styles), comments are pinned to page elements or selected text and stored per domain.
Every public uier.io page runs the toolbar itself as a [showcase](#landing-page-showcase-and-public-feedback):
anyone can try it and leave public feedback.

**Mark all as read** in the app comments list/board or toolbar inbox acknowledges only the
unread threads shown by the current filters. Replies arriving after that list was rendered stay
unread. Large lists are sent in batches of up to 200; failed writes offer Retry. Read activity
also suppresses pending email digests through the same per-reviewer cursor.

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
real Cosmos DB (an emulator or your own serverless account), copy [`apps/web/.env.example`](apps/web/.env.example)
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
  refused (CORS) with privacy-safe copyable owner notes, ended-session sign-in, offline recovery,
  and the app's comment list, board, filters, private comments, assignees, edit, delete,
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
between workspaces), the active projects for quick switching (their header links to all projects and, for
admins, to a new one), and at the bottom Clients (once a project has a client), Users (admins), "Give feedback"
(uier's own toolbar, see [public feedback](#landing-page-showcase-and-public-feedback)) and the account menu
(account, theme, sign out). It
collapses to icons on desktop (`Ctrl/Cmd+B`) and opens as a sheet on small screens. A top bar holds the
breadcrumbs. uier is free, so there is no billing page; pricing is the landing page's `brand.pricing` promise.

- **Sign in** (`/app/sign-in`): no passwords. The app emails a single-use link and an eight-digit numeric
  code. Both expire after 15 minutes and share one request: using either invalidates both. The link token
  is stored only as a SHA-256 hash; the code only as a request-specific keyed hash, compared in constant time.
  The code works only in the browser that requested it, using the signed HttpOnly `uier_sign_in_request`
  cookie (SameSite=Lax, Secure outside local development). It expires with the request and is removed on
  sign-in. A new request in that browser replaces its binding. Type the code only where you asked to sign
  in and never share it. Invitations keep their seven-day links.
  Five wrong codes invalidate the request, including its link. Atomic counters reserve at most five guesses
  before comparison, with no window reset during the request. Rejected browser bindings do not count against
  another request. Sign-in emails remain limited to 5 per address and 20 per IP per hour, so new requests
  cannot bypass the email limits. Locally and on previews, the page shows both the link and code.
  The first sign-in creates the account. Opening the link shows a "Continue" button, because email scanners
  open links before people do. The session is an HttpOnly `uier_session` cookie with a signed token (30 days;
  the key is derived from the server secret, like guest names). Signed-out visits to an app page return there
  after signing in (`proxy.ts`, `?next=`), including the toolbar's project review link.
- **Workspaces**: every user gets a workspace of their own on first sign-in and is its admin. Projects and
  members belong to a workspace; with more than one workspace the menu at the top of the sidebar switches
  between them. The workspace and its admin are created together, so a creator whom an admin removed is
  never added back by opening the app again: with no other workspace, they get a new, empty one of their own.
- **Projects** (`/app/projects`): one project per reviewed site, with its addresses (the main site first,
  then staging or preview addresses), its status (active or done) and who can comment. The page shows the
  active or done projects as cards with their open comments, who can comment and review links.
  An optional client name (up to 80 characters, with whitespace normalized) can be set at creation or
  in settings; the field suggests the existing clients as you type, and any other name adds a new one. It
  appears in project details and cards. The client filter sits beside Active/Done,
  offers All clients and No client, and stays selected in the URL across status changes and reloads.
  Client choices come only from projects the current member can see in the current workspace. The project
  code (12 lowercase letters and digits) is public: it is in the embed script.
  Addresses can include localhost, its subdomains, and loopback IPs for local development
  (for example `localhost:3000/app`, `preview.localhost:5173`, or `127.0.0.1:8080`). Without a
  scheme these use HTTP; other sites use HTTPS. Explicit `http://` or `https://` is preserved.
  The toolbar accepts only configured origins, including the scheme and port. Local sites
  open on the reviewer's own computer, so each reviewer needs the site running locally.
  - Onboarding: `/app/projects/new` (the addresses), then the install guide `/app/projects/<code>/install?onboarding=1`
    (the script, and on common platforms where to paste it and, in "Advanced", where the site's CSP is set and
    the sources to add to it). Both pages show the three-step progress (Your site, Add the script, Invite a
    reviewer). The install page starts at step 2 of 3 and adds the reviewer step below the guide: admins
    invite people by email for invited-only projects; guest projects show a plain, copyable review link for
    every address, main site first. Comments-off projects say so and link admins to Settings. The Install
    tab on its own is the guide without the progress or reviewer step.
  - A project has a header (name, addresses, who can comment, Invite and Open review) and three tabs:
    Comments, Install and Settings.
  - Comments `/app/projects/<code>`: the guest links for every address (in guest mode, main site first) and the project's **comments**, as a
    list or a board (Open / Done), filtered by people (all, assigned to me, opened by me) and page (relative
    URLs). Each comment shows its page URL, the device size it came from, when it was created, its author,
    assignee, replies and state, with Done, Link to comment and Assign; the author or an admin edits and
    deletes it, and only admins make it private. Follow thread, Copy issue, Reproduction details, browser
    context and assignment labels include icons. Empty lists retain Install the script; invited-only projects
    also offer admins Invite with the email sign-in explanation. Comments-off lists say so and link admins
    to Settings. Filtered lists keep Nothing here.
  - Install `/app/projects/<code>/install`: the install guide with the project code and **Check installation**.
    The check opens the actual configured site, confirms the script's project/API, reads comments and obtains a
    browser-verification proof without posting a test comment. CSP failures are diagnosed where browser evidence
    exists; missing scripts, private/unreachable sites, changed origins and interrupted checks stay inconclusive.
    Reports check the window, origin and a temporary nonce; no tokens, reviewer identity or page content are reported.
  - Settings `/app/projects/<code>/settings`: everyone mutes or unmutes their own project emails there. Admins
    also set the name, optional client name, who can comment (invited people, anyone with the link, or comments
    off), addresses, meaningful page-state fields, and see usage (comments, open, done, replies, pages, people
    with access) and done.
  - Review links `/app/review/<code>?url=<page>&comment=<id>` check access and redirect to the page with the
    toolbar's review link parameter `?toolbar-code=<code>`, a single-use code that signs the toolbar in
    (`uier-token`) and the comment to open (`uier-comment`); only addresses of the project are redirect
    targets.
  - Project embeds also try background sign-in through the hidden `/review-session` frame. A signed-in
    member can start reviewing a configured site without a link or top-level navigation. The separate
    `uier_review_sso` HttpOnly, Secure, SameSite=None cookie only authorizes project review handoffs;
    the app session stays SameSite=Lax. Existing logins receive it on their next app visit. Browsers that
    block cross-site cookies or frames keep the explicit link flow. No storage-access prompts are opened.
    Toolbar sign-out disables automatic sign-in on that site until an explicit authenticated review link;
    Exit review suppresses automatic opening in that tab. Pending one-use codes survive host redirects
    in session storage for at most ten minutes and are removed after exchange or definitive rejection.
- **Clients** (`/app/clients`): the client names of the projects the member can see, each with its projects
  and how many are active or done. A client opens the projects list filtered to it (its done projects when
  none is active). Clients are labels on projects, not records of their own: a client with no projects left
  is gone.
- **Users** (`/app/users`, admins only): the people in the workspace with their role (admin or commenter)
  and the projects they review, filtered by project (`?project=`), and the pending invitations. Admins
  remove people (the last admin stays), including the person who created the workspace, and revoke
  invitations. A removed member's review token stops working at once, because the review API checks the
  membership on every request.
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
| `POST /api/review/<code>/sso` | Same-origin frame-only background handoff: `{ origin }` plus the dedicated HttpOnly cookie; rechecks project/site/member access, returns a review token or 204. No CORS or app-cookie authentication |
| `POST /api/review/<code>/verification` | same-origin BotID verification from the empty `/review-verification` frame; a five-minute proof bound to the reviewed origin, project and reviewer |
| `GET`, `POST /api/review/<code>/comments` | the comments of a page (`?path=`) or of every page (`?scope=site`, the inbox) the reviewer can see, a new comment (`authorName` from guests) |
| `POST /api/review/<code>/comments/<id>/replies`, `PATCH`/`DELETE /api/review/<code>/comments/<id>`, `PATCH`/`DELETE .../replies/<itemId>` | replies, done (`resolved`), editing messages (`text`, `expectedText`), deleting |
| `GET /api/review/<code>/comments/<id>/screenshot` | the comment's screenshot, for reviewers who can see the comment |
| `PATCH /api/review/<code>/comments/<id>/anchor` | reattach with `{ path, position, expectedRevision }`; author/admin, saved page and original allowed origin only |
| `POST /api/review/<code>/comments/<id>/screenshot` | supply or replace saved evidence, with `{ screenshot, expectedRevision }`; author or workspace admin only |
| `POST /api/review/<code>/rewrite` | `{ text, instruction? }`: rewrite suggestions, as `POST /api/rewrite`, for reviewers who can comment (limited per reviewer and per project, and app-wide like `POST /api/rewrite`) |

- **Who**: a member with access, by the review token (`Authorization: Bearer`), or a guest, by a random
  visitor id (`X-Uier-Visitor`) and the name they give. Comment requests use headers, without cookies;
  only the same-origin background handoff uses its separate cookie inside the uier frame.
- **Who can comment** is enforced here: `403 comments_disabled` when comments are off, `401
  sign_in_required` for anyone but members when the project is for invited people.
- **CORS**: only the project's own site addresses get `Access-Control-Allow-Origin` (no credentials);
  requests from any other origin get `403`.
- **Permissions**: members mark any comment done, the author and the workspace admins delete it, private
  comments are listed only to admins and their author. Comments carry `permissions` and `canDelete`.
- Comments live in the comments container under the partition `project:<code>`, with the site's origin,
  the author (`user:<id>` for members) and no TTL. Guests keep the comments API's visitor and IP limits.
  Current project members get 100 new comments and 300 replies per project per hour, without the
  shared IP write limit. Public feedback project commenters keep the visitor and IP limits even
  after signing up. Page, screenshot and rewrite limits apply to every reviewer.
- **Bot protection**: writes on uier's origin use BotID directly. On reviewed sites, the toolbar opens an
  empty frame on uier's origin so BotID can verify there, without third-party cookies. The frame checks
  its parent's browser-supplied origin against the project's addresses and returns a signed five-minute
  proof. Every cross-origin write needs that proof in `X-Uier-Verification`, bound to its origin, project
  and reviewer. Only `/review-verification` and the empty `/review-session` background sign-in bridge
  can be framed; other pages keep their framing protection.
  The install guide includes `frame-src` for the API origin. BotID failures stop writes.

Data lives in the Cosmos DB container `app` (`app-preview` on previews), partition key `/pk`:

| Document (`type`) | `pk` | `id` |
| --- | --- | --- |
| `user` | `user:<id>` | `u_<nanoid>` |
| `user-email` (unique email -> user) | `email:<email>` | the email |
| `sign-in` (single-use link and browser-bound code, `ttl` 15 min; code stored as a request-specific keyed hash) | `sign-in:<hash>` | SHA-256 of the link token |
| `workspace`, `member`, `project` | `workspace:<id>` | `w_<userId>` (`w_<userId>_2`, ... after a removal), `member_<userId>`, the project code |
| `project-ref` (code -> workspace) | `project:<code>` | the project code |
| `review-code` (single-use code of a review link, `ttl` 10 min) | `review-code:<hash>` | SHA-256 of the code |

Email goes through Azure Communication Services (`ACS_CONNECTION_STRING`, sender `UIER_EMAIL_SENDER`, both
set by Pulumi). Links in emails use `https://uier.io` in production and the deployment URL on previews
(`UIER_BASE_URL` overrides both); never the request's Host header.

### Review email notifications

Owners and admins receive new feedback. Members automatically follow threads they post in, can follow or
unfollow any visible thread, and can mute project emails from the toolbar or the project's settings in the app. Guests can
optionally choose **Email me replies** after commenting and verify an address; neither email nor
an account is required to post. Related unread activity is batched for five minutes, with current
access, mute, unsubscribe and shared read-cursor checks before sending. A scheduled GitHub workflow
uses the existing production Cosmos/ACS configuration; no detached serverless work is used.
Digests say who acted, what happened and which thread/page changed, with recipient-specific mention
and assignment wording. Comment text is excluded by default. Workspace admins can enable **Include
comment excerpts** in project settings for every recipient, verified guests included; commenters
can see the setting. Quoted page text, screenshots and reproduction details stay out. Retained
failed or ambiguous attempts can keep enabled excerpts until reconciled, with no automatic expiry.

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

Every uier account automatically joins this workspace as a commenter of the feedback project.
Existing accounts are enrolled by a one-time, resumable provisioning backfill; sign-in and app
requests also ensure membership. Existing team admins keep their roles. This grants project access
directly, with no invitation email or acceptance step, and keeps each person's current workspace
and new-user onboarding as the default. Switch to the **uier** workspace to view the project.

The hero's `data-uier-thread="comment_uier_headline"` slot renders a live thread in an open shadow
root, sharing the toolbar's components, queries and anonymous visitor cookie. Both hero pins and the
text highlight come from stored comments. The inbox includes other public pages. Explicit review
links still start review mode; the signed-in app does not automatically publish a showcase.

The app's **Give feedback** button (sidebar, above the account) opens the same toolbar on the app page in
`feedback` mode, with its feedback form open (`openUierFeedback()` from `@uier/toolbar/react`). App pages show
people's private projects, so on the public project every comment on an `/app` page is **private**: only its
author and the uier team (the public project's admins, in the app) see it, in both comments APIs, whichever
toolbar left it. Comments the team makes private there are hidden from other visitors as well.
On uier's own pages the signed-in app session takes precedence over a guest cookie or visitor header:
the toolbar profile, comments, replies, drafts and read state use the account identity and current
display name. Signed-out visitors retain their guest identity; earlier guest feedback is not claimed
by signing in. Account sign-out remains in the app's account menu.

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

and the toolbar starts automatically for an authenticated project member when browser policy allows it,
or on pages opened with a review link, `?toolbar-code=<project code>` (the links the app
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

**Limits** (all in [`limits.ts`](apps/web/src/lib/comments/limits.ts)). Rate limits are fixed windows per domain or project,
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
| New comments per project member | 100 per project per hour; public feedback commenters keep 10 |
| Replies per project member | 300 per project per hour; public feedback commenters keep 30 |
| Replies per MCP credential | 30 per project per hour, also counted against the owner's member budget |
| Writes per IP (an IPv4 address or an IPv6 /64) | 30 per domain or project per hour for guests and public feedback commenters; project members do not consume it. The anonymous `/api/comments` API keeps this limit for every writer |
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

For an accidental operator delete, follow [Backups and restore](#backups-and-restore). Never recover
abuse, an author's deletion or content covered by an erasure request.

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
  communication service. A protected customer-managed `uier.io` domain and its ownership TXT, SPF TXT,
  DKIM CNAME and DKIM2 CNAME records come directly from ACS `verificationRecords`. DMARC uses its
  supplied record when present; the live API currently omits it, so `emailDns.ts` supplies the explicit
  owner policy `_dmarc.uier.io TXT "v=DMARC1; p=reject"`. No report mailbox is invented.
  The Azure-managed domain remains the production sender until the staged verification below is complete.
  The report endpoint receives production-only `UIER_EMAIL_REPORT_SECRET`, `UIER_EMAIL_REPORT_TOPIC`
  and `UIER_EMAIL_REPORT_SUBSCRIPTION`; its Event Grid subscription lands after the receiver deploys.

### Email domain verification and cutover

Before applying DNS, query the authoritative Cloudflare nameservers for apex TXT and `_dmarc.uier.io`
TXT. On 28 October 2026 neither had an SPF/DMARC record. Recheck before deployment: if another sender
has added one outside Pulumi, import that record and merge the policy in a reviewed PR. Never create
a second SPF policy or DMARC record. Preserve other senders and the existing DMARC policy.

Deploy the domain and all five DNS records described above through CI with `UIER_EMAIL_SENDER` unchanged.
Run the main-only **Verify email domain** workflow after the DNS deployment. It uses Azure OIDC
to check the provisioned records: ownership first, then SPF, DKIM, DKIM2 and DMARC. Read
`verificationStates` back from Azure until each
reports `Verified`; a DNS response alone is insufficient. Do not edit protected resources manually
or run `pulumi up` locally. The verification action only checks the provisioned DNS.

Prepare a separate cutover PR that reads the live domain with `getDomainOutput`, fails unless all
five states are `Verified`, adds its id to the existing communication service's `linkedDomains`
while retaining the Azure-managed domain, and sets `UIER_EMAIL_SENDER` to `DoNotReply@uier.io`.
Its reviewed preview must show an in-place communication service update: reject a replace/delete,
resource rename, key rotation or connection-string replacement. Keep engagement tracking disabled.

Ship `/api/email/reports` before a second PR creates its Event Grid subscription: infra runs before
Vercel on every deployment, and Event Grid validates the receiver immediately. Check
`Microsoft.EventGrid` registration first. The subscription uses only delivery reports and a secret
static `x-uier-email-report-secret` header. Never put the secret in a URL or a log. See
[the rollout and production acceptance gates](docs/review-notifications.md#staged-rollout-and-live-evidence)
for authorized recipient testing, message-id correlation, SPF/DKIM/DMARC and header evidence.
Keep `UIER_EMAIL_REPORT_MATCH_OPERATIONS` unset until correlation is proven, then enable it through
a reviewed production-only Pulumi change.

### Infrastructure state and credentials

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

### Backups and restore

Recovery owner: the repository owner, **AleksandarDev**, who names the human restore operator for each
incident. This procedure requires continuous backup; check the live account before using it. It is not
a recovery-time, recovery-point, uptime or regional disaster-recovery commitment. Vercel variables,
email and Pulumi state are outside this runbook. Restores are billed by data restored, including on
the seven-day tier. Keep the source account, production endpoint and Vercel variables unchanged.

#### Policy rollout and evidence

The policy change tracked in [#135](https://github.com/signalco-io/uier/issues/135) is deliberately
separate from this runbook. Periodic to continuous is **one-way**. Keep `protect` and all aliases.
Never run `pulumi up` locally or change the policy in the portal or CLI.

1. Record the current policy with this read-only command, before editing infrastructure:

   ```bash
   az cosmosdb show --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7 \
     --resource-group uier-production8b2f56d6 --name uierdbaba6cd56 \
     --query '{id:id,location:location,backupPolicy:backupPolicy}' -o json
   ```

2. Open a **policy-only PR with auto-merge disabled**. Its CI `pulumi preview` comment must show
   exactly one in-place account update to `Continuous` / `Continuous7Days`, and no other resource
   changes. If it shows replacement or any other change, close the PR and investigate separately.
   The owner must approve that exact preview and commit before it merges; a new head needs review again.
3. Watch that merge's deployment log. `pulumi up` has a 30-minute job timeout; migration duration
   depends on data size. On failure or timeout, **do not rerun** the job and do not change the policy
   manually. Run the read-only command above, report `backupPolicy.migrationState` and the failed
   deployment to the owner, and hold every merge/push to `main`, including Renovate automerges and
   manual deploy dispatches, until the owner resolves it. Every push would run `pulumi up` again.
4. After a successful deployment, record the output, date and deployment URL. Require
   `backupPolicy.type = Continuous`, `continuousModeProperties.tier = Continuous7Days` and
   `migrationState = null`. A subsequent full CI Pulumi preview must show no account diff.
   Do not treat a successful source merge as proof of migration.

Observed evidence (replace pending entries with actual results; never infer them):

| Gate | Recorded result |
| --- | --- |
| Before, 2026-10-28 17:30 UTC, `az cosmosdb show` | `uierdbaba6cd56`, West Europe; `type: Periodic`, `backupIntervalInMinutes: 240`, `backupRetentionIntervalInHours: 8`, `backupStorageRedundancy: Geo`, `migrationState: null` |
| Isolated policy preview, 2026-10-28 | [PR #160](https://github.com/signalco-io/uier/pull/160) closed without merging: [CI preview](https://github.com/signalco-io/uier/pull/160#issuecomment-6476154512) showed the account plus `vercel-uier-env-cosmos-endpoint-preview` updating (two resources). Auto-merge was never enabled. A new isolated proposal and owner approval are required. |
| Successful deployment, live continuous policy and no-diff account preview | Pending; continuous backup is not yet verified live |
| `comments-preview` restore drill, elapsed time and cleanup | Not run; waiting for policy and restore-access prerequisites |

Only after live confirmation, publish the seven-day point-in-time restore control on `/security`
and deleted-data backup retention on `/legal/privacy-policy`, update its effective date and extend
`e2e/pages.spec.ts` / `e2e/legal.spec.ts`. Keep `/legal/sla` without service commitments. Do not claim
geo-redundancy: continuous backups do not preserve the old periodic policy's geo-replicated snapshots.

#### Access and preparation

The named human operator needs **CosmosRestoreOperator** at the subscription or source
**restorable-account** scope (not the production resource group), plus account-write permission on
the destination resource group, for example Cosmos DB Operator there. A subscription owner grants
and records the operator, scope and expiry in the incident record. On 2026-10-28 the read-only
subscription-wide role-assignment listing found **no explicit CosmosRestoreOperator assignment**;
broader inherited permissions must be checked separately before any restore. Do not assume the
preview identity can restore or that a named operator already has access.

Keep **uier GitHub Deployment** at Contributor on `uier-production8b2f56d6`, with its existing
state/key permissions. Add no restore role to CI and no restore workflow. The preview identity
keeps Data Contributor only on `comments-preview` and `app-preview` in the source account.
The human copy operator separately needs data-plane read on the restored container and narrowly
scoped write on the destination. A restored account has **new keys** and does **not** inherit the
preview identity's Cosmos data-plane role assignments. Never put its keys in Vercel, logs or Git.

Before recovery, record the incident's accidental deletion, exact account/database/container,
partition and item ids, UTC time, original container `defaultTtl`, original item `ttl` and `_ts`,
and the author's/erasure decisions. Recover only items removed by mistake. Exclude author-deleted
messages, removed screenshots, abuse, erasure requests and expired data, even if present in backup.
For partial threads, sanitize deleted messages and evidence too. If deletion intent or original
expiry cannot be established, stop and ask the owner; do not copy it back.

#### Find the restore point

In the account's **Point In Time Restore** pane, use its event feed for database/container
create, replace and delete times. The feed does not show item edits or deletes: use the incident's
recorded UTC time for those and choose a point after the wanted write and before the mistake.
Use a timestamp within the available backup window and after continuous backup started; a new
migration does not create seven days of history retroactively.

Read-only CLI discovery (use the returned instance id, then the database `ownerResourceId`):

```bash
az cosmosdb restorable-database-account list --account-name uierdbaba6cd56 \
  --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
az cosmosdb sql restorable-database list --instance-id '<account-instance-id>' --location westeurope \
  --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
az cosmosdb sql restorable-container list --instance-id '<account-instance-id>' \
  --database-rid '<database-ownerResourceId>' --location westeurope \
  --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
az cosmosdb sql retrieve-latest-backup-time --resource-group uier-production8b2f56d6 \
  --account-name uierdbaba6cd56 --database-name uierdata --container-name comments-preview \
  --location westeurope --subscription d22db5bd-ca9a-447c-9b1b-dc56aca401d7
```

The latest restorable timestamp bounds a live-container restore; it does not identify the moment
before an item delete. Record the chosen timestamp and confirm both wanted documents existed then.

#### Deleted container or database: existing account

This is an incident procedure requiring separate owner approval, **never the drill**. A same-account
restore is only for a genuinely deleted resource; never delete a live container to make it eligible.
Hold `main` merges and deployments so Pulumi cannot recreate an empty resource during recovery.
The owner must arrange a maintenance window that blocks reads and writes to the affected resource
before submission. Keep it inaccessible until author deletions, erasure requests and expirations
have been reconciled. If that cannot be guaranteed, use an isolated temporary account instead.

Restore a missing parent database first. With the approved UTC timestamp, the human operator uses
`az cosmosdb sql database restore --resource-group <source-group> --account-name <source-account>
--name <deleted-database> --restore-timestamp <UTC> --disable-ttl false`. For a deleted child use
`az cosmosdb sql container restore` with the same arguments and `--database-name <database>`.
Specify the subscription explicitly on each command. Do not disable TTL in production. Read back
the restored container's TTL and partition key, reconcile retention and all excluded deletions,
restart SDK clients to discard stale session/continuation tokens, and verify API reads before
lifting maintenance. Review a full Pulumi preview for drift before the owner releases the merge hold;
never remove `protect` or run local `pulumi up` to reconcile it.

#### Live container: isolated temporary account and selected copy-back

Restore the smallest affected container into **a new account in its own temporary West Europe
resource group**, with TTL disabled so evidence cannot expire while being examined. Production
continues pointing at `uierdbaba6cd56`. The following is the preview-only drill target; for a real
incident, the owner must review a new exact container/item manifest before any submission.

```bash
recovery_subscription=d22db5bd-ca9a-447c-9b1b-dc56aca401d7
recovery_group='<unique-temporary-restore-group>'
recovery_account='<unique-temporary-account-name>'
recovery_time='<approved-UTC-timestamp-before-delete>'
az group create --subscription "$recovery_subscription" --name "$recovery_group" --location westeurope
az cosmosdb restore --subscription "$recovery_subscription" --resource-group "$recovery_group" \
  --target-database-account-name "$recovery_account" --account-name uierdbaba6cd56 \
  --restore-timestamp "$recovery_time" --location westeurope \
  --databases-to-restore name=uierdata collections=comments-preview \
  --disable-ttl true --public-network-access Disabled
```

Wait for completion and record `provisioningState` and `restoreParameters` from `az cosmosdb show`
on the temporary account; inspect each restored container to confirm TTL is disabled. Provision
owner-approved private connectivity for the human copy operator; do not open the account to the
public network to get around a failed read. Keep all recovered content in restricted storage.

Copy only the approved exact ids using a Cosmos SDK, never a whole-container import. For a thread,
point-read `(comment id, domain)` and `($screenshot_<comment id>, domain)` from the temporary
container and validate their linkage and current deletion/erasure status. Keep original metadata
for expiry calculations; strip Cosmos system fields (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`)
from new resource bodies. Keep ids, partition keys, project and screenshot references unchanged.
Create both documents in one single-partition transactional batch with **Create**, never Upsert,
and verify every result. A conflict aborts the copy for owner review; never overwrite newer data.

For each item calculate its original effective lifetime from its per-item `ttl`, falling back to
the **source** container default (not the TTL-disabled restored container):

```text
originalExpiry = original _ts + original effective ttl
remainingSeconds = floor(originalExpiry - current UTC epoch seconds)
```

Skip an item with `remainingSeconds <= 0`. Set the copied item's `ttl` to its own remaining seconds
immediately before submission, with a margin for write duration; never reset it to seven or 90 days.
Recheck returned destination `_ts + ttl <= originalExpiry` and shorten/delete the copied fixture
if necessary before considering recovery accepted. An original effective TTL of `-1` stays `-1`;
do not turn unknown expiry into unlimited retention. The preview source default observed on
2026-10-28 is `604800` seconds; production `comments` and `app` use `-1` with per-item exceptions.

For an accidentally removed `$sequence_comments`, copy only that sequence in its exact domain
partition. Pause writes to that partition, read the live highest comment number, and use the
greater of that and the backed-up sequence count. Use Create if absent; an existing sequence
needs a fresh read and ETag-conditional repair approved by the owner. Never decrease numbering or
copy rate counters, submission receipts, sessions or sign-in tokens. Read the destination back
independently, check references and original expiry, and verify the affected API/browser flow.

After validation, delete **only the temporary resource group** (verify its exact name and id first):
`az group delete --subscription "$recovery_subscription" --name "$recovery_group" --yes`.
Wait for completion, verify `az group exists` returns `false`, remove restricted local copies and
temporary grants/connectivity, and record cleanup even when an earlier step failed.

#### Required drill: comments-preview only

After the policy is confirmed live, obtain the owner's recorded approval for the named human
operator, restore access, temporary resource group/network and billed restore. Use a synthetic
comment and screenshot created solely for this drill, with the test author's prior consent to
delete and restore that fixture. This exception never authorizes recovery of real author deletions.

1. Open a PR preview and confirm its deployment uses `comments-preview`. Post a uniquely named
   synthetic comment with a screenshot in the toolbar. Record preview URL, partition, both ids,
   `_ts`, original TTL/default and the creation time without saving image contents in Git.
2. Wait until the latest restorable time covers both writes. Record a restore point after both
   writes and before deletion, then delete the comment in the toolbar. Confirm both exact documents
   are absent. Never delete the container or touch `comments`, `app` or `app-preview` for this drill.
3. Time the isolated restore above, selecting **only `uierdata/comments-preview`**. Recover only
   the two fixture documents back into **`comments-preview`**, with remaining TTL and an atomic
   create-only batch. Verify the thread and screenshot after reloading the same preview, and record
   independent item readback, effective expiry and unchanged production endpoint configuration.
4. Delete the temporary group and restricted files/grants as above. Remove the restored synthetic
   fixture through the toolbar and confirm absence. Record UTC date, operator, preview/policy PRs,
   approved manifest, restore timestamp, submit/ready times and elapsed duration, any corrected
   steps, readback/browser results and verified cleanup in the evidence table. Leave failed or
   unexecuted steps marked as such; this written procedure is not a successful drill.

Azure references: [one-way migration](https://learn.microsoft.com/en-us/azure/cosmos-db/migrate-continuous-backup),
[restore permissions](https://learn.microsoft.com/en-us/azure/cosmos-db/continuous-backup-restore-permissions),
[same-account restore](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-restore-in-account-continuous-backup),
[temporary-account restore and timestamps](https://learn.microsoft.com/en-us/azure/cosmos-db/restore-account-continuous-backup).

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

### Feedback environments

Project settings → Environments labels each configured **origin** (scheme, host and port).
Addresses with different paths on one origin share an environment. Different origins are isolated
by default, including older unlabeled projects: their origin is the label. Admins can set an
identical, case-sensitive alias group on equivalent origins to share feedback for matching canonical
page views. A label alone never groups addresses. Grouping changes the view; it does not copy or
migrate comments, change permission checks, or rewrite their source origins.

The toolbar's pins follow the current environment or explicit alias group. Its inbox has a visible
Environment filter and a deliberate All environments view. Counts/unread and bounded lists use the
same server-side scope. Selecting another environment changes the inbox, while new feedback is
still recorded on the site being reviewed. The filter is saved on that site for the API, project
and reviewer in `uier:environment:v1:<api>:<project>:<reviewer>` until browser data is cleared.
App filters are retained in the URL and survive reload. The app initially shows the main origin's
environment; the toolbar initially shows its current origin. Invalid/stale selections fall back to
that default. Direct comment links open the original configured origin and stored safe query/hash
state, even when aliases share feedback. Reattachment still requires the original reviewed origin. Opening a direct link overrides an old toolbar filter for
that visit. Notifications also retain the original source: unavailable sources link members to feedback history and give guests notification controls instead of a replacement site.
An allowed site that no longer responds can still fail at the browser; uier does not
proxy or provision previews.

Removed addresses remain searchable through Removed addresses or All environments, with the
recorded origin and disabled page links. Comments without a recorded origin remain in Source not
recorded or All environments; no current address is inferred for them. Re-adding the same origin
makes its links available again. Existing access, private-feedback and screenshot checks apply to
every scope. Environment isolation is a feedback view, not a separate membership boundary within
a project. No data migration or hosting changes are performed.

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
OAuth login/discovery and clients that require OAuth are not supported. **Client configuration**
in Account offers the following setups, built from the same endpoint. Merge entries into the
existing client file; keep the credential out of every file and URL. Set `UIER_MCP_TOKEN` in the
environment of the process that starts the client, then restart it.

**Codex** — `~/.codex/config.toml`. [Official bearer configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers):

```toml
[mcp_servers.uier]
url = "https://uier.io/api/mcp"
bearer_token_env_var = "UIER_MCP_TOKEN"
```

**Claude Code** — `.mcp.json`. [Official HTTP setup and variable expansion](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson):

```json
{
  "mcpServers": {
    "uier": {
      "type": "http",
      "url": "https://uier.io/api/mcp",
      "headers": { "Authorization": "Bearer ${UIER_MCP_TOKEN}" }
    }
  }
}
```

Keep the reference literal. Do not use a shell-expanded bearer header with `claude mcp add`:
it saves the expanded secret in settings. Approve the project server when Claude Code asks.

**Cursor** — `.cursor/mcp.json`. [Official config interpolation](https://cursor.com/docs/mcp#config-interpolation):

```json
{
  "mcpServers": {
    "uier": {
      "url": "https://uier.io/api/mcp",
      "headers": { "Authorization": "Bearer ${env:UIER_MCP_TOKEN}" }
    }
  }
}
```

**VS Code** is not offered because an actual client connection could not be verified in this
session. The [official configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
documents HTTP headers and masked `promptString` inputs (`password: true`, `${input:...}`).
A documentation check alone does not verify a connection; there is no ready block until that check passes.

**Claude Desktop** is not offered in the picker without a verified connection. Its
[custom connector request headers](https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers)
are in beta for a limited set of organizations. Where available on an individual plan, add a
custom connector by the endpoint URL, choose **No sign-in**, and enter
`Authorization: Bearer <credential>` under **Request headers**. Claude connects from Anthropic’s
servers, so this cannot reach a local endpoint. Remove and add the connector again after expiry
or revocation; saved authentication cannot be edited. Team and Enterprise are not supported:
an Owner adds custom connectors for the whole organization, so a personal uier credential would
be shared. Without Request headers, Claude Desktop is unsupported until OAuth exists. Do not
use a third-party bridge.

**Windsurf** is not offered because a deployed client connection could not be verified here.
Its [current documentation](https://docs.devin.ai/desktop/cascade/mcp) describes legacy Cascade
in Devin Desktop, with `serverUrl` and `${env:UIER_MCP_TOKEN}` header interpolation. Documentation
alone is not a completed client connection check.

The credential belongs to the named human account. It grants no additional project or private
feedback rights. Its selected projects do not expand when new projects are created.

| Tool | Scope | Behavior |
| --- | --- | --- |
| `list_projects` | `feedback:read` | Selected projects still accessible to the owner |
| `list_feedback` | `feedback:read` | Routing summaries with page, environment, anchor, assignment, author kind, unread and screenshot filters within a 1000-thread window |
| `get_feedback` | `feedback:read` | Thread, anchor, original reproduction context and authorized screenshot reference |
| `get_feedback_batch` | `feedback:read` | The same full packets for 1–10 distinct thread ids, in request order, within 256 KiB |
| `list_assignees` | `feedback:assign` | Existing participants eligible to see the thread |
| `reply_to_feedback` | `feedback:reply` | Validated reply as the human account, labeled with the credential name |
| `set_feedback_status` | `feedback:status` | Resolve/reopen using the app's permission checks |
| `assign_feedback` | `feedback:assign` | Assign an existing authorized participant, or `null` to unassign |

`get_feedback` returns `{ actingAs, contentTrust, context, markdown, screenshotResource? }`.
`context` and `markdown` come directly from the same authorized project export service as Copy
issue, using the shared [version 1 feedback context contract](docs/feedback-context.md). The MCP
resource reference supplements its protected web image link when image access was granted.
Deleted first-message evidence is unavailable through both the packet and screenshot resource.

`list_feedback` items include canonical `path`, `environment: { id, label }`, `anchorType`,
`assignee: { id, name }` or `null`, `authorKind`, `unread` and `hasScreenshot`. Deleted first
messages omit `authorKind` and report no screenshot. The response includes project `environments`
options and `searchWindow: 1000`. Optional filters are `path`, `environment`, `anchorType`
(`point`, `text`, `page`), `assignee` (`me`, `unassigned`, or a member id), `authorKind`
(`member`, `guest`), `unread` and `hasScreenshot`, combined with `search` and `status`.
Paths use the project's page-state policy. Page and environment filtering happens in storage
before the window; other filters, including unread, only search that window. Environment accepts
only a returned option id, `unknown` or `removed`; omit it to search all environments.

`get_feedback_batch` takes `{ projectId, commentIds }` and returns
`{ actingAs, contentTrust, items, remainingIds }`. Each item contains `commentId` and either the
same `context`, `markdown` and optional `screenshotResource` as `get_feedback`, or an `error` and
`message`. Missing, deleted and inaccessible ids all return `not_found`. A packet too large for
one response returns `too_large` for that id. The batch returns only whole packets that fit within
256 KiB; retry `remainingIds` separately. Duplicate ids, empty batches and more than ten ids are
tool errors. Each packet loads its authorized thread, member names and saved screenshot document;
batching reduces transport calls, not these storage reads. Both tools leave read cursors unchanged.

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

The connector exposes these user-selected MCP prompts:

| Prompt | Arguments | Behavior |
| --- | --- | --- |
| `triage-feedback` | `projectId` | Lists and groups open threads; changes nothing |
| `fix-feedback` | `projectId`, `commentId` | Reads a thread and proposes a code change in the client; leaves uier unchanged |
| `report-back` | `projectId`, `commentId` | Drafts a reply and/or status change; waits for approval before every write |

`report-back` is listed only with `feedback:reply` or `feedback:status` and names only the write
tools granted to that credential. Calling it without either scope is rejected. Prompt arguments
use the tools’ identifier schemas; project grants and current membership are checked on every
retrieval. Prompts contain instructions and validated identifiers, never feedback text: every
feedback read still goes through an authorized tool.

In **Prompts and agent skill**, copy or download `SKILL.md` and save it as
`uier-feedback/SKILL.md` in your client’s skills directory (see
[Codex skills](https://learn.chatgpt.com/docs/extend/skills) or
[Claude Code skills](https://code.claude.com/docs/en/skills)). Its `name` and `description` front
matter identify the workflow. It lists every tool with its required scope, treats feedback as
untrusted and requires approval before every write, including assignments. It contains no
credential. `apps/web/src/lib/mcp/workflows.ts` generates both the prompt instructions and the
skill; update that source together with any tool contract changes.

List tools accept `limit` (1–25, default 20) and numeric `cursor` (default 0), returning `nextCursor`
or `null`. Cursors are offsets in current results, so concurrent additions can shift a page. Search
is bounded to the latest 1000 threads; use known ids to read older feedback. Requests are limited
to 16 KiB and 120 per user per minute across credentials. Replies also have a 30-per-credential,
per-project hourly limit and consume the owner's 300-per-project hourly member budget. Public feedback
commenters retain their 30-reply visitor budget and shared IP limit. Exhausted credentials do not consume
more of the owner's reply budget. Thread/image sizes retain existing review validation limits.
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
