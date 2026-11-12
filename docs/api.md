# API reference and toolbar delivery

Routes, identity, storage and limits for the review and public comments APIs, plus how the
website builds and serves the toolbar. See [MCP](mcp.md) for coding tool access.

## Realtime comment changes

The embedded toolbar and the app's project comment list/board use Vercel Functions WebSockets
at `/api/realtime`. They need Fluid compute, which Pulumi enables on the Vercel project
(`infra/src/vercel.ts`). It is not set in `apps/web/vercel.json`: CI deploys prebuilt output
without a checkout, so the deploy step never reads that file. Without Fluid compute every upgrade
fails with `502` and clients stay on HTTP refresh. The function has a 300-second limit and closes
sessions after four minutes so clients can renew on every plan.

`GET /api/review/<code>/realtime`, `GET /api/comments/realtime` and the member-only
`GET /api/realtime/ticket?projectId=<internal id>` issue five-minute, purpose-separated signed
tickets under their existing identity and CORS rules. The ticket is bound to the exact page origin,
API origin, viewer and project/partition. It stays in memory and is sent as the first frame:
`{"type":"subscribe","token":"..."}`. Never put a review/session token or realtime ticket in a URL.
The socket accepts one subscription, with a five-second handshake deadline and 2 KiB frame limit.

The server sends only `{"type":"ready"}` and `{"type":"comments.changed"}`. It rechecks current
project/address/membership access and private-thread visibility before notifying. Message text,
comment ids, counts, revisions and actor ids are never sent as events. A notification refetches
the existing authorized HTTP projection; reconnect also refetches to cover missed changes.

The initial cross-instance source polls compact Cosmos metadata (`id`, visibility and `_etag`)
every two seconds while sockets are active. Concurrent subscriptions in one instance share the
partition read. Creation, edits, replies, reactions, assignment, status, screenshots and hard deletion are
detected regardless of which API, MCP or integration process committed them. This is metadata
polling behind a WebSocket transport, not a durable event log or a delivery guarantee. Per-reviewer
read cursors live separately and converge through safety reads. There is no additional provider,
database schema migration, write-side publishing or credential to configure.

`src/lib/realtime/source.ts` and `@uier/toolbar/realtime` separate change detection and browser
subscription from the Vercel upgrade adapter. A later pub/sub provider can replace those boundaries.
Measure Cosmos `comments.realtime` request charges and Function memory/connection usage before
expanding the polling frequency or replacing the source; complete metadata scans grow with project
size and authorization checks still run per socket. A reviewed site's CSP needs the API's explicit
`wss://` origin in `connect-src` (`ws://` for local HTTP). New install snippets include it; existing
sites that block sockets continue using adaptive HTTP refresh.

## Review API (a project's toolbar)

A project's toolbar (`data-uier-project`, see the [toolbar README](../packages/toolbar/README.md)) runs on the
customer's site and calls `/api/review/<code>` on uier.io, implemented in
[`apps/web/src/lib/review`](../apps/web/src/lib/review). The routes mirror the comments API:

| Request | What |
| --- | --- |
| `GET /api/review/<code>` | the project (name, who can comment, page-state policy; configured `feedbackTypes` and the reviewer's effective optional [`toolbarFeatures`](../apps/web/docs/project-settings.md#toolbar-features) list only when they can comment), the reviewer and whether they can comment, the sign-in URL, and `language`: `{ default, source, preference? }`, the [toolbar language](../apps/web/docs/project-settings.md#toolbar-language) (`source`: `project`, `workspace` or `default`; `preference`, the account's own choice or `null`, only for a member) |
| `POST /api/review/<code>/language` | `{ language }` (a language code, or `null` for the project's): a member's own toolbar language, saved to their account; also where comments are off. Guests get `401 sign_in_required` before the body is read |
| `POST /api/review/<code>/session` | `{ code }`: exchanges a review link's single-use code (10 minutes) for a review token (30 days) |
| `POST /api/review/<code>/sso` | Same-origin frame-only background handoff: `{ origin }` plus the dedicated HttpOnly cookie; rechecks project/site/member access, returns a review token or 204. No CORS or app-cookie authentication |
| `POST /api/review/<code>/verification` | same-origin BotID verification from the empty `/review-verification` frame; a five-minute proof bound to the reviewed origin, project and reviewer |
| `GET`, `POST /api/review/<code>/comments` | the comments of a page (`?path=`) or of every page (`?scope=site`, the inbox) the reviewer can see, a new comment (`authorName` from guests). Without paging parameters a list is the plain array of its newest comments, as before. `?limit=` (1 to 200, default 200) or `?before=` asks for one keyset page, newest first (`createdAt`, then id), answered as `{ comments, next }`: `next` is the `before` of the following page, or `null` at the end, and it is also set when the response was cut at its 1 MB size limit. The cursor, filters and visibility apply in storage before the limit, so paging reaches every thread (`apps/web/src/lib/comments/listPage.ts`, `apps/web/src/lib/repo/commentPage.ts`). `?unread=true` is one page and rejects paging parameters |
| `POST /api/review/<code>/comments/<id>/replies`, `PATCH`/`DELETE /api/review/<code>/comments/<id>`, `PATCH`/`DELETE .../replies/<itemId>` | replies (`{ text, screenshot?, mentions?, idempotencyKey? }`), archive (`{ archived }`) or status (`{ status }`: `open`, `in-progress` or `done`; or the earlier `{ resolved }`, exactly one operation; see [In progress](#in-progress)), editing messages (`text`, `expectedText`), deleting |
| `GET /api/review/<code>/comments/<id>/replies/<itemId>/screenshot` | the reply image, with the same thread visibility and private Blob read contract as the original screenshot |
| `POST /api/review/<code>/comments/<id>/reactions` | `{ itemId, emoji, reacted, authorName? }`: adds or removes the reviewer's own emoji reaction to one message (the quick set of `@uier/toolbar/reactions`); `200` the thread. Who may reply may react; see [message reactions](../apps/web/docs/reactions.md) |
| `GET /api/review/<code>/comments/<id>/screenshot` | the comment's screenshot, for reviewers who can see the comment |
| `PATCH /api/review/<code>/comments/<id>/anchor` | reattach with `{ path, position, expectedRevision }`; author/admin, saved page and original allowed origin only |
| `POST /api/review/<code>/comments/<id>/screenshot` | supply or replace saved evidence, with `{ screenshot, expectedRevision }`; author or workspace admin only |
| `POST /api/review/<code>/rewrite` | `{ text, instruction? }`: rewrite suggestions, as `POST /api/rewrite`, for reviewers who can comment (limited per reviewer and per project, and app-wide like `POST /api/rewrite`) |
| `POST /api/review/<code>/page-checks` | a page's [page check summary](#page-checks), from project members only; `204` |
| `POST /api/review/<code>/page-suggestions` | `{ kind, text, title?, description? }`: a page's AI suggestions, as `POST /api/page-suggestions`, for reviewers who can comment (counted with rewrite suggestions; see [Page suggestions](#page-suggestions)) |

- **Who**: a member with access, by the review token (`Authorization: Bearer`), or a guest, by a random
  visitor id (`X-Uier-Visitor`) and the name they give. Comment requests use headers, without cookies;
  only the same-origin background handoff uses its separate cookie inside the uier frame.
- **Who can comment** is enforced here: `403 comments_disabled` when comments are off, `401
  sign_in_required` for anyone but members when the project is for invited people.
  The same-origin showcase `/api/comments` reads the public project's current access setting
  and enforces the same rule, using its signed-in account or guest identity. Its private feedback
  remains author-only, including `/app` threads without a stored private flag; activity counts and
  single/bulk read receipts use the same visibility as listing.
- **CORS**: only the project's own site addresses get `Access-Control-Allow-Origin` (no credentials);
  requests from any other origin get `403`.
- **Permissions**: members mark any comment done, the author and the workspace admins delete it, private
  comments are listed only to admins and their author. Comments carry `permissions` and `canDelete`.
  Assignee ids and mention ids use `^u_[A-Za-z0-9_-]{1,64}$`; malformed assignment ids return
  `400 invalid_request` before any participant lookup. Members also get `assignee.agent`, the AI agent
  working under the assignee (`{ kind, label, model?, reasoning?, sessionId?, setAt }`); guests never do, and the
  review API has no write for it ([AI agents](review-workflow.md#ai-agents-under-the-assignee)). A message an
  AI agent wrote through MCP carries `agent` (`{ kind, label, model?, reasoning? }`, the model and reasoning
  level for members only) and its author name ends with "via Claude"; the review API's replies never set it
  ([messages an AI agent writes](review-workflow.md#messages-an-ai-agent-writes)).
- Comments live in the comments container under the partition `project:<code>`, with the site's origin,
  the author (`user:<id>` for members) and no TTL. Guests keep the comments API's visitor and IP limits.
  Current project members get 100 new comments and 300 replies per project per hour, without the
  shared IP write limit. Signed-in commenters in uier's user feedback project get 30 new comments per hour
  (three times a visitor's) and keep the visitor reply and IP limits. Page, screenshot and rewrite limits apply to every reviewer. New comments through
  the same-origin showcase `/api/comments` (including the app's Give feedback) record the public
  project's address as their origin too.
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
| `sign-in` (single-use link and browser-bound code, `ttl` 15 min; code stored as a request-specific keyed hash; `googleLinkId` when it confirms a waiting Google account) | `sign-in:<hash>` | SHA-256 of the link token |
| `google-sign-in` (a [Google sign-in](google-sign-in.md) in progress, `ttl` 10 min; state and nonce as SHA-256 hashes, no PKCE verifier) | `google-sign-in:<id>` | 64 random hex characters |
| `google-link` (a verified Google account, for an address Google is not authoritative for, waiting for an email code before the account is created or linked, `ttl` 15 min) | `google-link:<id>` | 64 random hex characters |
| `user-identity` (unique Google account -> user) | `identity:google:<sub>` | Google's `sub` |
| `google-account` (the user's linked Google account: `sub`, its address for display, when it was linked) | `user:<id>` | `google` |
| `passkey` (a user's passkey: credential id, COSE public key, signature counter, transports, AAGUID, backup flags, name, `createdAt`, `lastUsedAt`; the source of truth) | `user:<id>` | `passkey_<SHA-256 of the credential id>` |
| `passkey-credential` (unique credential id -> user, for a point read at sign-in) | `passkey:<hash>` | SHA-256 of the credential id |
| `passkey-challenge` (single-use WebAuthn challenge, `ttl` 5 min; `register` with its user or `sign-in`) | `passkey-challenge:<id>` | 32 random bytes, hex |
| `workspace`, `member`, `project` | `workspace:<id>` | `w_<userId>` (`w_<userId>_2`, ... after a removal), `member_<userId>`, the internal project id |
| `client` (who projects are for: name, description, icon, colour; projects point to it with `clientId`), `client-name` (unique name -> client) | `workspace:<id>` | `client_<nanoid>`, `client_name_<SHA-256 of the name>` |
| `project-ref` (internal id -> workspace) | `project:<id>` | the internal project id |
| `project-public-ref` (public id -> project and workspace) | `project-public:<publicId>` | the public id |
| `review-code` (single-use code of a review link, `ttl` 10 min) | `review-code:<hash>` | SHA-256 of the code |
| `page-check` (a page's [page check summary](#page-checks), `ttl` 90 days from its last check; at most 200 per project) | `page-checks:<projectId>` | `page_<SHA-256 of origin and page, 40 hex>` |
| `integration-discovery-cursor` (bounded source-outbox scan) | `integrations:worker` | `pending` |

Project feedback carries server-only synchronization versions, pending markers and indexed source
keys. A hard delete atomically writes a text-free `tombstone` in the same comments partition
(`$tombstone_<commentId>`, TTL 30 days). It is removed after each destination has durable deletion
work and never appears in comment lists or DTOs. See [the shared delivery contract](integrations.md).

Email goes through Azure Communication Services (`ACS_CONNECTION_STRING`, sender `UIER_EMAIL_SENDER`, both
set by Pulumi). Links in emails use `https://uier.io` in production and the deployment URL on previews
(`UIER_BASE_URL` overrides both); never the request's Host header.

App server actions validate positional arguments before use as well as checking the session and role.
The app's `replyCommentAction` validates project/thread ids, trimmed text, selected mention ranges
and a required `idempotencyKey`. It resolves the current session/workspace/project and constructs
the service Request from server request headers, preserving IP rate-limit metadata. Actor and
permission claims never come from client fields. It uses `replyToProjectComment`, its atomic
receipts, current-access checks, limits and event/sync writes; replies on Done threads keep Done.
The on-demand `commentParticipantsAction` rechecks membership and private-thread visibility and
returns eligible account names and opaque ids only, without email addresses. Guests cannot use
these app actions and keep their existing review-API reply permissions. Actions revalidate the
project's authorized comments snapshot. Draft scopes, seven-day expiry and local-storage recovery
are described in [the review workflow](review-workflow.md#draft-recovery-and-submission-retries).

Boolean settings are also validated by the services that persist them. Member removal compares the
loaded user id, then atomically updates the workspace removal version and deletes the versioned
member; concurrent removals recheck the admin count. A removed membership is never restored.
Sign-in return paths are rebuilt with `new URL()` against a fixed origin, restricted to `/app`
and its descendants, and reject dot segments (including encoded forms), backslashes and controls.

Browser account selection uses `POST /api/account/sessions`: a strict JSON body of
`{ action: "switch", userId, next? }`, `{ action: "sign-out" }` or `{ action: "sign-out-all" }`.
It requires the app's own Origin and same-origin Fetch Metadata when present. A selection requires
that account's live, signed HttpOnly credential already in the browser; an id or the active account's
credential cannot authorize a different account. It returns `{ next }` for a full document navigation,
with no credentials in JSON. `GET` returns only `{ userId: string | null }` for the active session,
rejects cross-site browser requests and never falls back to parked accounts. Both responses are
private, no-store and vary by Cookie. Up to five independent sessions retain their original expiry,
recent-sign-in time and account email proof; see [sign-in](../apps/web/docs/sign-in.md#several-accounts-in-one-browser).

Passkeys (`src/lib/app/passkeys.ts`, `@simplewebauthn/server`) use the RP ID and origin of
`appBaseUrl()`. Every ceremony's challenge is a single-use record that only the winner of an atomic
delete may verify, bound to the browser by the signed HttpOnly `__Host-uier_passkey_challenge` cookie
(the record id only). Registration requires a discoverable credential, user verification, `none`
attestation, Ed25519, P-256 or RSA, and a session signed in within the last 10 minutes (the session
token's `iat`), checked for the options and again against the challenge. A registration writes the
`passkey-credential` lookup first and the `passkey` second, so an interrupted write leaves only an
unused lookup; sign-in needs both, and a lookup older than a minute without its passkey is replaced
or deleted. Removal deletes the passkey first, so it stops working at once. Sign-in rejects a
signature counter that does not move forward unless both counters are zero, and updates the passkey
conditionally on its version. Options (60) and verifications (30) are limited per IP address per
10 minutes.

### Public project identifiers

Generated guest links, member review redirects, install snippets and guest notification links use a
separate `project.publicId`: a cryptographically random, URL-safe 21-character Nano ID (126 bits).
The review API resolves it through a point-read reference, then verifies that it is still the
project's published id. Internal project ids, comment partitions, memberships and MCP grants stay
unchanged. Public ids are identifiers; project access settings and member authorization still apply.

New projects receive a public id at creation. Existing projects receive one on their first app or
internal service read, including uier's feedback project. An optimistic update keeps concurrent
requests on one durable id; failed claims never resolve. No bulk data migration is required.
Previously shared random 12-character project codes and installed embeds remain supported. The
fixed `uier00000001`, `uier00000002` and `uier00000003` values (uier's own projects) are internal-only at the review API; copy its new link or script from the
app. The same-origin public showcase continues through `/api/comments`.

Deleting a project replaces its code and public id claims with retired claims that name no project.
Both ids then answer `404` and are never issued again ([project deletion](project-deletion.md)).
Transferring a project to another workspace points both claims at the new workspace, so both ids,
review links and embeds keep working there ([project transfer](project-transfer.md)).

## `/toolbar.js`

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
[`packages/toolbar/README.md`](../packages/toolbar/README.md#embedding)). The link only starts the review: the
project whose comments apply is the script's `data-uier-project`, so `?review=true` on a project's site reviews
that project too, "View project" included. It calls the API on the origin of its own script URL, so a preview
deployment's landing page talks to that preview's API.

The embed first downloads a small loader. React, the review UI, styles and screenshot code are
downloaded only when review is active, a project member is confirmed by background sign-in, showcase
mode is enabled, or feedback is requested. Fonts are loaded when the UI mounts. The loader snapshots
script configuration before downloading the review UI, shares concurrent loads, and permits retries
after a failed download. Both scripts are classic scripts, with the loader nonce passed to the review
script for CSP compatibility.

`pnpm build` in `apps/web` first copies the production loader of `@uier/toolbar` (a workspace devDependency,
built before the web app through Turborepo's `^build`) to `apps/web/public/toolbar.js`
([`scripts/copy-toolbar.mjs`](../apps/web/scripts/copy-toolbar.mjs); the copy is gitignored and a Turborepo build
output). It refuses to copy a development build. [`next.config.ts`](../apps/web/next.config.ts) serves it with
`Content-Type: application/javascript`, `Cache-Control: public, max-age=300, s-maxage=3600` and
`Access-Control-Allow-Origin: *`. Vercel builds through Turborepo as well (`buildCommand` in
[`apps/web/vercel.json`](../apps/web/vercel.json)), so `vercel build` produces it too, and every deployment of the
website ships the toolbar built from the same commit.

**Caching and updates.** The bundle is a static file of the deployment, served by Vercel's CDN (compressed, with
an `ETag`). The URL is not versioned, so it is cached briefly and never `immutable`:

- The CDN keeps it for up to an hour (`s-maxage=3600`). Its cache key includes the deployment, so a new
  production deployment serves its own bundle from the first request (`x-vercel-cache: MISS`, then `HIT`); no
  purge is needed. A rollback (promoting an earlier deployment) serves that deployment's bundle the same way.
- Browsers reuse their copy for up to 5 minutes (`max-age=300`), then revalidate with `If-None-Match` and get a
  `304` while the bundle is unchanged. A release reaches every visitor within 5 minutes of the deploy
  (other shared caches on the way may keep it for up to an hour).

The default embed follows new releases. **Advanced: pin this version** in the install guide instead provides
HTML and Next.js snippets with `/toolbar/<sha256>.js`, `integrity="sha384-..."` and
`crossorigin="anonymous"` (`crossOrigin` in JSX). These content-addressed files use
`Cache-Control: public, max-age=31536000, immutable` and `Access-Control-Allow-Origin: *`.
The SHA-256 path and SHA-384 integrity value describe the loader bytes (`@uier/toolbar/bundle`).
The loader contains the exact review script's SHA-256 path and SHA-384 integrity value, generated
after its CSS is inlined, and loads it with anonymous CORS. `copy-toolbar.mjs` publishes identical
loader bytes at the default and pinned paths, the review script, the accessibility audit asset
(axe-core, which the review script pins the same way and loads only for its Accessibility panel) and the
language assets (each toolbar language but English, pinned the same way and loaded only when the toolbar shows
it, [toolbar languages](../packages/toolbar/docs/localization.md)) at their content-addressed paths, and a
no-store `/toolbar/manifest.json` archive index. The manifest retains the loaders, their review scripts, audit
and language assets; a pinned loader never switches to a newer review UI.

Pinned production bundles remain available and compatible with the review API for one year after
their last release as the current version. They get fixes only when the site updates its snippet.
This support window is independent of a browser's cache lifetime. Production builds fetch the
previous manifest and supported bundles from uier.io, verify every SHA-256, and carry them forward
before deployment, forcing build tasks so cached outputs cannot restore an older archive; expired
files are pruned. Missing bundles, invalid manifests, size limits and
fetch/hash failures fail the build. A manifest 404 bootstraps the first release. Previews also carry
the production archive, but preview/local pins belong to their own deployment. For a rollback,
rebuild the chosen revision with the current archive; promoting an old deployment can lose pins
published after it. See [operations](operations.md#pinned-toolbar-bundles).

The toolbar and its inline threads use a shared constructed stylesheet inside their shadow roots.
The reviewed site's `style-src` needs no inline-style exception or nonce. The install guide lists
the script/API/frame origin, data images and optional Google Fonts sources separately.

**On other sites** the toolbar needs a project: with the project's script tag (`data-uier-project`, from the
app's install guide) it uses the [review API](#review-api-a-projects-toolbar), which answers CORS for the
project's own addresses and identifies reviewers with headers instead of cookies. BotID verification runs
in a frame on uier's origin. [`embed.spec.ts`](../apps/web/e2e/embed.spec.ts) checks listing, posting and
replying from another site without cookies; [`project-review.spec.ts`](../apps/web/e2e/project-review.spec.ts)
checks permissions and the install guide's CSP. An embed without `data-uier-project` is for uier's own
same-origin showcase only. Failed comment loads show a message and a retry action.

On uier's own pages, Add comment also targets every part of the toolbar (the pill, the inbox, an
open thread, popovers and menus) when the page and API share an origin. Point mode selects the part
without activating it, and open popovers stay open; Cancel or Escape ends placement. Keyboard
reviewers can focus a control before using Add comment. These comments keep their shadow-root
anchors (`#uier-toolbar>>>`), with the toolbar button that opens a popover or the inbox as their
`layer.opener` (and, for a menu inside an open thread or popover, the toolbar buttons that open the
inner layers in `layer.nested`, outside in), and capture the reviewed UI in screenshots. Third-party embeds keep uier's own
controls outside comment targeting, and the review API answers `400 invalid_request` to a toolbar
anchor or opener (`layer.opener` or `layer.nested`) from a project's site (a cross-origin `Origin`), when creating or reattaching.

## Comments API

[`apps/web/app/api/comments`](../apps/web/app/api/comments), implemented in
[`apps/web/src/lib/comments`](../apps/web/src/lib/comments). JSON in and out; comments are partitioned by the
public project (`project:uier00000001`, the Cosmos DB partition key `domain`) and stored per page path (without query string and
trailing slash). A signed-in account's requests use the user feedback project (`project:uier00000002`): new comments go
there (private), lists and activity include the account's own threads and the public ones, and `/api/comments/{id}` routes
find the thread in either. `sourcePath` is the same page as it was addressed, for links (see **Source paths** below).

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/comments?path=/x` | | `200` comments of the page, newest first (max. 200 and 1 MB), resolved ones included (`resolved: true`) |
| `GET /api/comments?scope=site` | | `200` comments of every page of the domain, newest first, with the same limits (the toolbar's inbox) |
| `POST /api/comments` | `{ path, sourcePath?, position, kind?, text, quotedText?, check?, drawing?, device?, screenshot? }` | `201` the new comment, with `screenshot: { width, height }` when it has one (see [Screenshots](review-workflow.md#screenshots)). `kind` is `comment` (default; `position` is a point, an area or a text selection: a point is `{ "type": "point", selector, xNormal, yNormal }`, fractions of the element's box, and an area adds `widthNormal` and `heightNormal`, both above 0 and within the element, with the point as its top-left corner; a point or a text selection in a menu, popover or dialog may add `layer: { opener, label? }`, the selector of the page element that opens it and that element's name, up to 120 characters), `rewrite` (a suggested replacement for selected text: `position` is a text selection, `text` the suggested text, `quotedText` the original), or `feedback` / `bug` with `position: { "type": "page" }` (about the page, no pin). `check` is the page check a comment was posted from, `{ type, id, count? }`: `type` is `accessibility`, `seo`, `consent` or `web-vitals`, `id` the rule or check (`image-alt`, `canonical`, `lcp`; lowercase letters, digits and hyphens, up to 64), and `count`, only on one comment for several of the check's elements on the page (the panels' "Comment on all"), how many it covers (a whole number from 2 to 10,000; nothing else is accepted beside these three). It is saved as sent, returned with the comment and never changes; comments without `count` are about one element or the page. `drawing`, only with `kind: comment` on an area, is what the toolbar's [canvas mode](../packages/toolbar/docs/canvas-mode.md) drew: `{ version: 1, width, height, shapes }`, the shapes from the area's top-left corner with the brand's colour names, checked by `parseDrawing` of `@uier/toolbar/drawing` (200 shapes, 6,000 points, 32,000 characters) and returned with the comment |
| `POST /api/comments/{id}/replies` | `{ text, screenshot?, idempotencyKey? }` | `201` the updated comment; anyone may reply |
| `POST /api/comments/{id}/reactions` | `{ itemId, emoji, reacted }` | `200` the updated comment; adds or removes the visitor's own reaction to one message; anyone who can reply |
| `PATCH /api/comments/{id}/replies/{itemId}` | `{ text, expectedText }` | `200` the updated thread; the message's author only. Includes the first message. A stale edit gets `409` and does not overwrite newer text |
| `PATCH /api/comments/{id}/anchor` | `{ path, position, expectedRevision }` | `200` updated thread; author only, exact saved page and validated element/text selector. `expectedRevision` is `anchorContext.revision` or `null`; stale anchors return `409` |
| `PATCH /api/comments/{id}` | `{ resolved }`, `{ status }` or `{ archived }` | `200` the updated comment; author only. `status` is `open`, `in-progress` or `done` ([In progress](#in-progress)) |
| `GET /api/comments/{id}/replies/{itemId}/screenshot` | | `200` the reply image, for people who can read the thread; `404` for a missing/deleted reply or image |
| `GET /api/comments/{id}/screenshot` | | `200` the comment's screenshot (`image/webp`, `image/jpeg` or `image/png`), public like the comment; `404` when it has none |
| `POST /api/comments/{id}/screenshot` | `{ screenshot, expectedRevision }` | `200` updated comment; author only. `expectedRevision` is the current image revision, or `null` for an original/missing image; stale evidence returns `409` |
| `DELETE /api/comments/{id}` | | Deletes the first item; author only. `204` when the comment is gone, or `200` with the comment when other visitors replied (see below) |
| `DELETE /api/comments/{id}/replies/{itemId}` | | `200` the updated comment; author of the reply only. The first item is deleted as with `DELETE /api/comments/{id}`; `204` when the comment is gone |
| `GET /api/visitor` | | `200` `{ name, language }`: the visitor's guest name, `null` before their first write (the toolbar's profile), and the toolbar language as in `GET /api/review/<code>` (`preference` only for a signed-in account) |
| `POST /api/visitor/language` | | `{ language }`: a signed-in account's toolbar language on uier's own pages, as `POST /api/review/<code>/language`; guests get `401 sign_in_required`, and no visitor cookie is created |
| `DELETE /api/visitor` | | `204`; signs out: removes the `__Host-uier_visitor` cookie (never creates one) |
| `POST /api/rewrite` | `{ text, instruction? }` | `200` `{ suggestions }`: up to 3 rewrites of selected page text, none when the model declines (see [Rewrite suggestions](#rewrite-suggestions)); `503 unavailable` without an API key or when the model can't be reached; never sets the visitor cookie |
| `POST /api/page-suggestions` | `{ kind, text, title?, description? }` | `200` `{ suggestions }`: up to 3 titles, meta descriptions or questions the page answers (`kind`: `title`, `description` or `questions`), none when the model declines (see [Page suggestions](#page-suggestions)); `503 unavailable` without an API key, when the model can't be reached or answers with something other than a list; never sets the visitor cookie |

Security and compliance retains the `consent` comment-check type for compatibility. Its new
security observations use `security-*` IDs; the existing consent IDs remain valid. Export labels
use the new tool name. Security reports are browser-local and enter the API only when a reviewer
explicitly posts a finding, as described in [the security-check scope](../packages/toolbar/docs/page-checks-security.md).

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
seconds and `reason`: `too_fast` or `page_full`; for a signed-in project member also `usage`, the app path of the
page that shows the limit: `/app/account/usage#project-<code>` for their own limits,
`/app/workspace/usage?project=<code>#project-<code>` for what the project shares), `500 server_error` and `503 unavailable` (rewrite and page suggestions only). Writes are accepted only from the API's
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

Authorized project members additionally receive `reproduction`: browser/version and OS, the original viewport and
pixel ratio, the browser's capture-start timestamp and a safe reviewed-page link, and on newer comments the phone or
tablet model, primary input (`touch`/`mouse`), colour scheme (`light`/`dark`), reduced motion and the page's language
tag. The toolbar parses the browser and OS in the reviewer's browser from Chromium's client hints or, without them,
the user-agent string, and sends only those names (`device.browser` and `device.os`, at most 64 characters; a version
only when the browser reports a real one); the user-agent string itself is never sent or stored, and neither is the
IP address or anything derived from it. `device.model` (64 characters), `input`, `colorScheme`, `reducedMotion` and
`pageLanguage` (language, script and region, `en-GB`) are dropped when the value is not one the API knows, without
failing the comment. Threads, inbox entries and app cards offer expandable, copyable details. Missing/older fields say Unknown
or Unavailable. Public and guest responses keep the restricted `device` shape and omit `reproduction`, even for
the author. Links retain the stored page identity described below; review tokens and unapproved query fields are
excluded. Replies, edits and viewport changes keep the original context.

**Meaningful page state.** Projects default to pathname-only review. Admins can choose up to 12 non-sensitive query
names in Settings → Review → Advanced → Page state and enable `#/...` or `#!/...` hash routes. The shared
[`pageState.ts`](../packages/toolbar/src/pageState.ts) contract (also exported as `@uier/toolbar/page-state`) normalizes
trailing slashes, percent encoding, query order and duplicate values. Hash-route prefixes are preserved so copied
links work with the site's router. Tracking, review activation and recognized credential/identity fields cannot
be selected. Values are limited to five per field, 128 characters each; emails, URLs, token-like values and common
credential hash routes are omitted. Choose only fields that never contain personal or secret values.
To help choose, a new project comment also stores `queryKeys`: the names, never the values, of up to 12 other
query fields on the page (search and hash-route query) that could be selected and had a value the policy would
keep. The toolbar sends them only while the page is still the comment's view, the API drops approved and invalid
names, and they are never part of a comment response; Settings → Review → Advanced → Page state suggests the most common ones from the
newest 200 comments, together with names in the stored path of older comments. Keys longer
than 2048 characters fall back to pathname; the public showcase keeps its existing 512-character pathname contract.

New project records have `pageStateVersion: 1`; their `path` is the canonical view key, used consistently by APIs,
queries, caches, inbox groups, app links and durable drafts. SPA push/replace, back/forward and hash changes update
the view without carrying placement controls or draft text onto another view. Old pathname records stay on the base
page and in the site inbox. The old query-string fallback applies only to legacy records, never to v1 views.
**Source paths.** The page key drops trailing slashes, so comments on `/plans` and `/plans/` share a page. Some
sites serve only one of the two, so new comments also send `sourcePath`: the page as it is addressed, filtered
with exactly the same policy (`sourcePagePath` in `pageState.ts`), keeping only its trailing slashes. The API
filters it again, stores it only when it is the same page as `path` and differs from it, and drops it otherwise;
an absolute or protocol-relative value, a backslash or a control character returns `400`. Responses include
`sourcePath` only when it differs from `path`. Copy link, the inbox's Open on link, the app's Open on link and
member redirects, Copy issue page links, reproduction links and notification links use it on the stored, authorized
origin. Older comments have none and keep linking to `path`; a stored value that no longer matches its page key is ignored.

There is no bulk migration. Changing settings does not rewrite stored feedback: old view links still restore the
website URL and show saved details in the inbox if the current routing policy no longer identifies that view.
Drafts recover across reload and navigation; see [Draft recovery and submission retries](review-workflow.md#draft-recovery-and-submission-retries).

**Anonymous identity.** The first comment or reply sets the `__Host-uier_visitor` cookie (reading comments and asking
for rewrite suggestions never do): 32 random bytes (base64url), `HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`, `Secure` everywhere
except plain http on a loopback host (local development and tests). Comments store only
`authorId = sha256(token)`, never the token. Visitors are shown as `Guest XXXX` (4 hex characters of an HMAC of
the author id with a server key, so a name can't be forged offline) and as "You" for their own items; the API
returns `isMine` / `author.isMe` so only the author sees the resolve and delete actions. Signing out in the
toolbar (`DELETE /api/visitor`) removes the cookie: the comments stay, and that browser gets a new identity with
its next write. The server key is
`UIER_COMMENTS_SECRET`, a random value Pulumi sets separately for production and previews (locally a fixed
development key); changing it changes every guest name and nothing else.

**Limits** (all in [`limits.ts`](../apps/web/src/lib/comments/limits.ts)). Rate limits are fixed windows per domain or project,
counted atomically in small counter documents (`type: 'counter'`, id = HMAC of the subject and window, expiring
shortly after the window) in the comments container, so concurrent requests can't exceed them and comments
carry no IP-derived data:

| Limit | Value |
| --- | --- |
| Request body | 16 KB (`413`); a reply with an image about 700 KB; a new comment with an image and a drawing about 800 KB |
| Screenshots | PNG, JPEG or WebP, 512 KB and 4096 px on a side; 300 per domain or project per day |
| Comment / reply text | 1-1000 characters after trimming, at least one visible character; bidirectional override characters are removed; quoted text up to 1000 |
| Path / selectors / selected text | 512 / 1024 / 2000 characters |
| Thread | 50 messages (replies are appended atomically) |
| New comments per visitor | 10 per hour |
| Replies per visitor | 30 per hour |
| New comments per project member | 100 per project per hour; signed-in commenters in uier's user feedback project get 30 |
| Replies per project member | 300 per project per hour; uier's feedback commenters keep 30 |
| Replies per MCP connection (access token or connected app) | 30 per project per hour, also counted against the owner's member budget |
| Writes per IP (an IPv4 address or an IPv6 /64) | 30 per domain or project per hour for guests and uier's feedback commenters; project members do not consume it. The anonymous `/api/comments` API keeps this limit for every writer |
| New comments per page | 100 per day (`reason: page_full`) |
| Rewrite suggestions | 20 per visitor (with the cookie) or project reviewer per hour, 300 per domain or project per day; app-wide, whatever the site: 40 per IP per hour and 1000 per day; selected text and each suggestion up to 1000 characters (what a rewrite comment holds), instruction up to 300. Page suggestions count against the same limits |
| Page suggestions | page text 1-4000 characters, title up to 200, description up to 500; a suggested title 10-60 characters, a description 50-160, a question up to 150 on one line |

**Bot protection: [Vercel BotID](https://vercel.com/docs/botid)** (basic mode, no captcha).
[`instrumentation-client.ts`](../apps/web/instrumentation-client.ts) attaches the BotID challenge to the page's
same-origin `POST`/`PATCH`/`DELETE` requests to `/api/comments*` (and `POST /api/rewrite`, `POST /api/page-suggestions`), and every write handler calls `checkBotId()`
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

**Storage.** Screenshot bytes use private Azure Blob Storage; Cosmos retains small references. Authorized
new toolbar clients receive a 60-second single-image read URL, while older clients retain the image response.
See [screenshot storage](screenshot-storage.md) for environments, CSP, migration and cleanup.

| Environment | Store |
| --- | --- |
| Vercel production | Cosmos DB container `comments` (production Entra identity via `COSMOSDB_ENDPOINT`, `COSMOSDB_COMMENTS_CONTAINER=comments`) |
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
[`infra/src/index.ts`](../infra/src/index.ts) is updated.

`COSMOSDB_COMMENTS_CONTAINER` selects the container (default `comments`). All of these variables are managed by
Pulumi (see [Infrastructure](operations.md#infrastructure)).

## Page checks

A project member's toolbar checks every page they review in the background, then saves a small summary of
what it found to the project ([the reporter](../packages/toolbar/docs/page-checks-site.md)); the project's
**Page checks** view in the app lists the pages together ([the view](../apps/web/docs/page-checks.md)).

`POST /api/review/<code>/page-checks` ([`src/lib/pageChecks`](../apps/web/src/lib/pageChecks)) takes one
page's summary, a strict JSON object (unknown fields are refused, `400 invalid_request`):

| Field | What |
| --- | --- |
| `path` | the canonical page key, as for a comment; the project's page-state policy applies again |
| `sourcePath` | optional: the page with its trailing slash, for links; kept only when it is the same page |
| `title`, `description` | optional: the page's title (up to 200 characters) and meta description (up to 300), one line of plain text without control characters |
| `noindex` | whether the page asks search engines not to index it |
| `accessibility` | optional: axe-core's issues by impact, `{ critical, serious, moderate, minor }` |
| `seo` | the SEO checks to look at and passed, `{ warn, pass }` |
| `checks` | each check's state (`pass`, `warn` or `none`) by `seo:<id>` or `accessibility:<id>`, the id of lowercase letters, digits and hyphens (up to 64); at most 150 |
| `vitals` | optional: `lcp` and `inp` in milliseconds (up to 600,000), `cls` (up to 100), each only when measured |

Counts are whole numbers from 0 to 100,000. The body is at most 16 KB. The answer is `204`.

- **Who**: project members only, through the review API's identity, CORS, origin and BotID verification
  (above): a guest or a public viewer gets `403 forbidden`, anyone but a member of an invited project `401
  sign_in_required`. Writes from the project's sites need the verification proof like every review write.
- **Storage**: one `page-check` document per page and environment in the `app` container's
  `page-checks:<projectId>` partition, keyed by the site's origin the request came from and the canonical
  page. The latest summary replaces the page's previous one, whose counts and time it keeps as `previous`.
  At most 200 pages per project: a new page beyond that removes the least recently checked ones. A page not
  checked again for 90 days expires. Deleting the project deletes them; a transfer keeps them. No element,
  page text beyond the title and description, or reviewer is stored.
- **Limits**: 120 summaries per member per hour and 2,000 per project per day (`429 rate_limited`, reason
  `too_fast`, with `Retry-After`), counted after validation.
- **Read**: only the app's Page checks page, for people who can see the project; there is no read route.

## Rewrite suggestions

The toolbar's **Rewrite** action (selected text) can ask for AI suggestions: `POST /api/rewrite` (a project's
toolbar: `POST /api/review/<code>/rewrite`) ([`src/lib/rewrite/suggest.ts`](../apps/web/src/lib/rewrite/suggest.ts)) calls the Anthropic API with the official
SDK: model `claude-sonnet-5-5` at `low` effort, a JSON schema for the answer (`{ suggestions: string[] }`), and the
server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), which retries a
request a safety classifier declines on Anthropic's recommended model. The selected text and the instruction are
treated as content, never as instructions. Each call has `max_tokens: 4096` and a hard 1000-character limit per
suggestion in its prompt; longer suggestions, duplicates and the original are left out, never cut. A request the
model still declines gives no suggestions (`200`, the toolbar says "No suggestions for this text."); a failure, or
no answer within 45 seconds (both attempts), is `503 unavailable`. The limits (above) are checked before the model
is called: per visitor and per site or project, and app-wide per IP and per day (counters in the `app`
partition), so more sites or projects never add up to more. Request and response content is not stored and no cookie is
set; a suggestion the reviewer posts is saved as a comment with `kind: "rewrite"` (its text is the suggested
text, `quotedText` the original).

The SDK reads `ANTHROPIC_API_KEY`. In production Pulumi sets it from the GitHub production-environment secret `ANTHROPIC_API_KEY`
(the Pulumi workflow passes it in like the Vercel and Cloudflare tokens); without the secret no variable is
created. Previews and local development have no key: the endpoint answers `503 unavailable` and the toolbar says
suggestions are not available, while the reviewer's own rewrite still works. Set `ANTHROPIC_API_KEY` in
`apps/web/.env.local` to try them locally. The e2e tests point the app at a stand-in for the API
([`e2e/support/anthropicStub.ts`](../apps/web/e2e/support/anthropicStub.ts), started by `playwright.config.ts` on
`PORT + 1000`), which checks each request and answers with canned suggestions.

Workspace settings → Rewrite suggestions stores admin-only style instructions (up to 2,000 characters).
Project General can follow the current workspace default, append project instructions (up to 2,000
more characters, after a blank line), or replace it. An empty replacement explicitly uses no extra
style guidance. Both routes resolve the current owning workspace on the server when a project is
present; isolated anonymous showcase domains have none. The request body stays `{ text, instruction? }`:
client-supplied configuration is ignored, and responses never include saved or effective instructions.
Saved settings persist, while individual rewrite requests and unused suggestions do not. Guidance is
escaped user-message content for tone, terms and style, subordinate to the fixed system rules and
JSON schema. It cannot change the model, response format, output limits or budgets. See the
[shared inheritance pattern](../apps/web/docs/project-settings.md#workspace-defaults-and-project-settings).

Both routes emit one bounded operational usage event per configured model call, including responses with no usable
suggestions. No selected text, reviewer instructions, saved style guidance, generated text or customer identifiers
enter these events. Provider input usage includes the guidance in the same call; it is not charged or
estimated separately.

The same key writes [AI thread titles](review-workflow.md#ai-thread-titles) with `claude-haiku-5-5`, after the
response of the request that created or changed a thread, never in its path. See
[AI thread title costs](ai-title-costs.md).
See [rewrite usage and costs](rewrite-costs.md) for daily reports, versioned pricing, retry/fallback gaps and the
current model evaluation. Estimates are not provider invoices.

## Page suggestions

The toolbar's SEO panel (its AI search section, [the note](../packages/toolbar/docs/page-checks-ai-search.md)) can ask
for a page's suggestions: `POST /api/page-suggestions` (a project's toolbar: `POST /api/review/<code>/page-suggestions`,
for reviewers who can comment), implemented in [`src/lib/pageSuggestions`](../apps/web/src/lib/pageSuggestions). The body
is a strict object (other fields are `400`): `kind` (`title`, `description` or `questions`), `text` (the page's main text
as Markdown, the first 4000 characters the toolbar read), and the current `title` and `description` (up to 200 and 500).
The toolbar sends it only when the reviewer presses a button, and says so ("Sends this page's main text to uier.").

- **The same call as rewrite suggestions** (`createSuggestionCall` in [`src/lib/rewrite/suggest.ts`](../apps/web/src/lib/rewrite/suggest.ts)):
  the same model, `low` effort, `{ suggestions: string[] }` schema, refusal fallback, `max_tokens`, 45-second deadline, key
  and `503 unavailable` without one (checked before the limits count the request). Its own fixed system prompt per kind
  states the length as a hard limit.
- **The page is untrusted content.** The text, title and description are escaped (`&`, `<`, `>`) inside their own tags
  (`<page_text>`, `<current_title>`, `<current_description>`) in the one user message, after the system rules, which say
  they are material to describe, never instructions, and that nothing the page does not say may be added.
- **The answer is bounded on the server.** An answer that is not JSON with a list of strings is `503 unavailable` (its
  content never reaches the response). Each suggestion is trimmed, loses bidirectional overrides, and is dropped (never
  cut) unless it is one line with a visible character within its kind's length: a title 10 to 60 characters and a
  description 50 to 160 (the SEO panel's own ranges), a question up to 150. Duplicates and the page's current title or
  description are left out; at most three are kept. A declined request gives none (`200`, `[]`).
- **Limits**: counted with rewrite suggestions, on the same counters (per visitor with the cookie or project reviewer, per
  site or project, and app-wide per IP and per day; [above](#comments-api)), so the app's daily budget for paid
  suggestion calls stays one. The usage pages' "Rewrite suggestions" meters include them.
- **Workspace settings**: a project's effective rewrite instructions (Workspace settings → Rewrite suggestions, and the
  project's) apply as the same escaped style guidance. No other setting governs them.
- **Bot protection** like `POST /api/rewrite`: BotID on uier's origin (`instrumentation-client.ts` attaches it to
  `POST /api/page-suggestions`), the review API's verification proof on a project's site. No cookie is set.
- **Accounting**: one `rewrite_usage` v1 event per model call, like rewrites, with `feature: "page_suggestions"` (rewrite
  events leave the field out); no page text, title, description, suggestion or identifier enters it.
- **Packaged clients**: the extension's closed route contract (`extensionContract.ts`) does not include these routes, and
  its toolbar shows no suggestion buttons.

Request and response content is not stored. A suggestion the reviewer posts is an ordinary comment about the page
with the check `{ type: "seo", id: "title" }` or `"description"`.
The e2e stand-in ([`e2e/support/anthropicStub.ts`](../apps/web/e2e/support/anthropicStub.ts)) checks these requests too
(one `page_text` boundary, the kind's stated limit); `page-suggestions.api.spec.ts` covers validation, bounds, the shared
limits, a prompt injection in the page text, the project route's prompt and usage event, and the not-configured answer.

## Linked pull request state

`GET /api/projects/<projectId>/comments/<id>/pull-requests` returns an array of `{ url, state? }` for
provider PR links in the thread's current saved messages. State is `open`, `merged`, `closed` or `draft`
when readable; unavailable state leaves the canonical link alone. Only the app's session cookie is
accepted (`401` signed out), with current project membership and private-thread visibility (`404`
otherwise). Invalid ids are `400`, cross-site browser requests are `403`. Responses are `no-store`,
vary on Cookie and allow no CORS. The request accepts no provider URL or credential. It runs outside
the server action queue. Provider reads, permission requirements, shared cache expiry and budgets are
described in [the integration note](../apps/web/docs/integrations.md#linked-pull-request-state).

## Profile pictures

A signed-in person sets their picture on Account → General → Profile; Google and Microsoft sign-in
can bring one too ([Google](google-sign-in.md#profile-picture), [Microsoft](microsoft-sign-in.md#profile-picture)).
[`src/lib/app/avatars.ts`](../apps/web/src/lib/app/avatars.ts) owns them.

| Route | Answer |
| --- | --- |
| `POST /api/account/avatar` (`multipart/form-data`, field `file`) | `200` `{ url }`: the new picture of the signed-in person |
| `DELETE /api/account/avatar` | `204`: no picture (initials), also when there was none |
| `GET /api/avatars/<userId>/<version>` | `200` the WebP image, for any signed-in person; `404` once replaced or removed |

- **Writes** need the session and an `Origin` of the app's own host (`Sec-Fetch-Site`, when sent, must be
  `same-origin`): a multipart form needs no CORS preflight, so `403` otherwise, then `401` signed out. Each
  account can change its picture 30 times an hour (`429`).
- **Validation** reads the format from the file's first bytes, never its name or declared type: PNG, JPEG,
  WebP or GIF (first frame), at most 4 MB (`413`; a request body over the limit is cut off while it is read)
  and 25 million pixels (a 24 MP phone photo); anything else is `415` or `400` with a message for the Account page. The browser
  scales down a larger photo before sending it, whether it was chosen, dropped or pasted. Sharp decodes the image and keeps only pixels: upright,
  the centre square, at most 256 pixels (never scaled up), WebP without metadata.
- **Storage**: a `user-avatar` document (`avatar_<version>`, base64; usually under 30 KB, at most 96 KB even for noise) in
  the person's own `user:<id>` partition, and `avatar: { version, source, updatedAt }` on their `user`
  document. Setting, replacing and removing change both, and delete the previous image, in one
  transactional batch with the user's etag, so a reference never points to a missing image and no old
  image stays behind. The image is small enough for Cosmos DB, so it needs no Blob container or orphan
  sweep and is restored with the account from backups.
- **Reading**: the address is `KnownPageLinks.avatar(userId, version)`, from `avatarUrl(user)`. The version is
  random (21 characters) and new for every image, so only pages that show the person hand the address
  out, and its bytes never change: `Cache-Control: private, max-age=31536000, immutable`, with `nosniff` and
  `Cross-Origin-Resource-Policy: same-origin`. Signed out is `401`; errors are `no-store`. It is under
  `/api`, not `/app`, because `proxy.ts` makes every app page response `no-store`.
- **Showing**: `PersonAvatar` (and `AvatarImage` in the comment rows and thread) shows the picture with the
  name's initial while it loads, if it fails and for people without one. Member lists, project access, the
  account menu and the comments inbox take `avatarUrl` from `listMembersWithUsers` / `listProjectMembers`;
  a comment's author and assignee show a picture only while they can still review the project. The review
  API and the toolbar do not include pictures.

## Client logos

Admins edit a client's avatar on Workspace → Clients → Edit client. Icon and colour choices appear in
its avatar popover. A custom logo replaces the icon tile everywhere `ClientMark` is shown.
[`clientLogos.ts`](../apps/web/src/lib/app/clientLogos.ts) owns storage and authorization.

| Route | Answer |
| --- | --- |
| `POST /api/workspaces/<workspaceId>/clients/<clientId>/logo` (`multipart/form-data`, field `file`) | `200` `{ url }`: the new logo |
| `DELETE /api/workspaces/<workspaceId>/clients/<clientId>/logo` | `204`: icon/letter again, also when no logo was set |
| `GET /api/workspaces/<workspaceId>/clients/<clientId>/logo/<version>` | `200` WebP for a current member who can open a live project of this client |

Uploads use the same byte sniffing, size/pixel limits, square WebP normalization, request body bound,
same-origin checks and browser downsizing as [profile pictures](#profile-pictures). Writes require a
current admin with a visible client (`403` for a non-admin) and allow 30 changes per person per hour
(`429`). Signed out is `401`; a hidden, foreign, unused or missing client is `404`. Direct and team
project grants both count for reads; knowing a URL alone grants no access. Replaced/removed versions
are `404`; errors are `no-store`.

The image (`client-logo`, `client_logo_<version>`, base64) lives in the client's workspace partition.
Creating/replacing/removing the `DbClient.logo` reference and deleting its previous image is one
transaction with the client's etag. Concurrent detail edits preserve the logo. Each random version
names immutable bytes with `Cache-Control: private, max-age=31536000, immutable`, `nosniff` and
`Cross-Origin-Resource-Policy: same-origin`. Logos remain app-only, outside review and MCP projections.

## Feedback priority and app triage

Comment DTOs add `priority`: `low`, `normal`, `high` or `urgent`. Missing stored values and older
pinned-client responses mean `normal`; no eager migration runs. Authorized project review DTOs
add `permissions.priority`. Guests can read priority, while edits require current project membership
and thread visibility. uier's public feedback project additionally requires current staff authority.

`PATCH /api/review/:projectId/comments/:id/priority` accepts
`{ priority, idempotencyKey }`, with the existing origin, identity, BotID proof and private-thread
checks. The extension broker also allowlists this PATCH through the same service and proof checks;
its registration gate stays unchanged. The key uses the shared 16–128-character submission-key syntax. A real change advances
activity once and records integration source intent; it does not create an email event. A no-op or
receipt replay does neither. Responses use the normal authorized review DTO. Invalid priority is
`invalid_request`; missing and hidden threads share `not_found`.

The app's authenticated `triageCommentsAction` calls `triageProjectComments` with one operation:
`{ kind: 'priority', priority, items }`, `{ kind: 'assignment', assigneeId, items }` (null unassigns),
or `{ kind: 'status', resolved, items }`. Each item contains a valid comment `id`, distinct
`idempotencyKey` and `expected` affected value (priority, assignee id/null or resolved boolean).
Status items also require the rendered 64-character opaque content `revision`. No other status
semantics or reviewer confirmation can be supplied by the client.

The service rejects empty, duplicate, malformed or over-50 batches before writes. String and array
limits bound the payload. It rechecks project/member visibility, action permissions and eligible
assignees per item and on conditional-write retries. At most four mutations run concurrently; each
uses the shared single-thread service and atomic comment/submission receipt transaction. It returns
ordered `results` with `success`, `noop`, `conflict`, `unavailable` or `failure`, actual counts, and
allowlisted saved triage fields on success/no-op. Missing/inaccessible ids share unavailable.

Receipts retain changed/no-op outcomes for 30 days. Replay reauthorizes and returns current saved
fields without applying an old desired state over later work. Unchanged retries must preserve the
original keys, operation and expected values. Status revisions cover content and future workflow
metadata, excluding delivery bookkeeping. Follow-up verification rules belong in the shared status
service so individual and bulk writes remain compatible. This is partial success, not a transaction
across all selected threads. The app revalidates once per batch; bulk read remains its own contract.

## Fix verification

`POST /api/review/:projectId/comments/:id/verification` uses existing project CORS, reviewer
identity, verified-write protection and private-thread access. The same-origin public-project
counterpart is `POST /api/comments/:id/verification`, with the normal visitor/session and BotID
checks. It is unavailable for isolated anonymous host partitions.

Requests require a stable `idempotencyKey` and `expectedRevision` (null for a thread with no
verification record). Supported payloads are:

- `{ action: 'request', reviewerId: 'author' | memberId, expectedRevision, idempotencyKey, summary?, fixUrl? }`.
- `{ action: 'confirm' | 'reject', expectedRevision, idempotencyKey, override? }`.
- `{ action: 'cancel', expectedRevision, idempotencyKey, override?, status? }`: `status` (`open` or
  `in-progress`) is where the thread goes; without it, where it was before the request.

Summary is plain text, up to 500 characters. Fix URLs are up to 2,048 characters; external URLs
must be HTTPS without credentials or query/fragment state, and configured destinations must
match approved project page state. No URL is fetched. Guest projection respects source access.

Only current project members request checks; the target is the original usable author or another
eligible member. Confirm/reject require the requested reviewer and a distinct requester, or a
different admin with explicit `override: true`. Cancel requires the requester or an admin.
Membership, project mode, visibility and reviewer authority are rechecked during conditional-write
retries. Stale revisions return `409 conflict`. Receipt replay reauthorizes and returns current
state without overwriting later work or producing another event.

DTOs add optional `verification` (latest request id/revision, outcome, display names, request time,
summary/link and latest named/timed decision with override attribution) and `verificationPermissions`.
Guest actor hashes never leave storage. Legacy records need no migration. The resolved boolean
remains compatible: Ready is false, confirmation is true, and ordinary true never confirms.
Activity summaries add `ready`, a subset of `open`, over the full authorized projection.
Reject (Still needs work) moves the thread to In progress; confirm ends In progress.

## In progress

A thread is Open, In progress, Ready to verify or Done ([review workflow](review-workflow.md#in-progress)).
Comment DTOs add `inProgress: true` while the stored flag is set and the thread is not done; it is
absent otherwise, and on every thread stored before it existed (no migration). The stage is
`feedbackStage` of `@uier/toolbar/verification`: Done, then Ready to verify (a pending check), then
In progress, else Open. `resolved` is unchanged, so In progress is `resolved: false`.

`PATCH /api/review/:projectId/comments/:id` and `PATCH /api/comments/:id` take exactly one of
`{ resolved: boolean }` (unchanged: `true` is Done and ends In progress; `false` reopens a Done thread
to Open and leaves In progress) or `{ status: 'open' | 'in-progress' | 'done' }`. Both, neither,
`ready` or another value is `400 invalid_request`. The same people who resolve may set it (project
members; a guest or visitor on their own thread). A status write that leaves Ready to verify ends the
check without confirmation. Activity summaries add `inProgress`, a subset of `open`.


Project page feedback also accepts an enabled custom type's stable `kind: "custom_<id>"` with
`position: { type: "page" }`. The server resolves the project's current workspace defaults or
replacement list and rejects disabled, unknown or other-project types. It captures a custom
thread's `feedbackType: { id, label, icon }` itself; submitted display metadata is ignored. The
snapshot remains on authorized comment DTOs after settings change. Built-in `comment`, `rewrite`,
`feedback` and `bug` retain their existing meaning and positions; turning off a page feedback type
does not block reading or replying to old threads. See [project settings](../apps/web/docs/project-settings.md).


## Comment archive

Archive is reversible and separate from workflow. Both comments APIs accept exactly one PATCH
operation: `{ archived: true }` archives, `{ archived: false }` restores, or the existing `{ status }`
/ `{ resolved }` changes workflow only. Project archive authority is the existing resolve permission;
public comments remain author-only. Visibility and verification checks are unchanged.

DTOs add optional `archivedAt`; missing means not archived. Status, completion time, pending
verification, messages, attachments, assignment and read cursors are retained. Ordinary lists exclude
archived threads; `archive=only` lists the archive and `archive=all` explicitly includes both. Filtering
precedes storage limits. Activity summaries exclude archived threads from ordinary totals and unread
badges and add a separate authorized `archived` count. Authorized direct reads, images and v1 exports
remain compatible; exports add `archivedAt` and an Archived label without changing status/stage.
No production data migration is required.

## Versioned filtering and ordering

The [comment query backend reference](../apps/web/docs/comment-query.md) documents project,
workspace, public and review query/count/options/capability endpoints, single-thread detail reads,
versioned expressions, execution budgets, live keyset cursors, saved views and expiring query links.
Current app and toolbar screens keep using their existing APIs until the UI migration.
