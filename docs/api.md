# API reference and toolbar delivery

Routes, identity, storage and limits for the review and public comments APIs, plus how the
website builds and serves the toolbar. See [MCP](mcp.md) for coding tool access.

## Review API (a project's toolbar)

A project's toolbar (`data-uier-project`, see the [toolbar README](../packages/toolbar/README.md)) runs on the
customer's site and calls `/api/review/<code>` on uier.io, implemented in
[`apps/web/src/lib/review`](../apps/web/src/lib/review). The routes mirror the comments API:

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
  The same-origin showcase `/api/comments` reads the public project's current access setting
  and enforces the same rule, using its signed-in account or guest identity. Its private feedback
  remains author-only, including `/app` threads without a stored private flag; activity counts and
  single/bulk read receipts use the same visibility as listing.
- **CORS**: only the project's own site addresses get `Access-Control-Allow-Origin` (no credentials);
  requests from any other origin get `403`.
- **Permissions**: members mark any comment done, the author and the workspace admins delete it, private
  comments are listed only to admins and their author. Comments carry `permissions` and `canDelete`.
  Assignee ids and mention ids use `^u_[A-Za-z0-9_-]{1,64}$`; malformed assignment ids return
  `400 invalid_request` before any participant lookup.
- Comments live in the comments container under the partition `project:<code>`, with the site's origin,
  the author (`user:<id>` for members) and no TTL. Guests keep the comments API's visitor and IP limits.
  Current project members get 100 new comments and 300 replies per project per hour, without the
  shared IP write limit. Public feedback project commenters keep the visitor and IP limits even
  after signing up. Page, screenshot and rewrite limits apply to every reviewer. New comments through
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
| `sign-in` (single-use link and browser-bound code, `ttl` 15 min; code stored as a request-specific keyed hash) | `sign-in:<hash>` | SHA-256 of the link token |
| `passkey` (a user's passkey: credential id, COSE public key, signature counter, transports, AAGUID, backup flags, name, `createdAt`, `lastUsedAt`; the source of truth) | `user:<id>` | `passkey_<SHA-256 of the credential id>` |
| `passkey-credential` (unique credential id -> user, for a point read at sign-in) | `passkey:<hash>` | SHA-256 of the credential id |
| `passkey-challenge` (single-use WebAuthn challenge, `ttl` 5 min; `register` with its user or `sign-in`) | `passkey-challenge:<id>` | 32 random bytes, hex |
| `workspace`, `member`, `project` | `workspace:<id>` | `w_<userId>` (`w_<userId>_2`, ... after a removal), `member_<userId>`, the internal project id |
| `client` (who projects are for: name, description, icon, colour; projects point to it with `clientId`), `client-name` (unique name -> client) | `workspace:<id>` | `client_<nanoid>`, `client_name_<SHA-256 of the name>` |
| `project-ref` (internal id -> workspace) | `project:<id>` | the internal project id |
| `project-public-ref` (public id -> project and workspace) | `project-public:<publicId>` | the public id |
| `review-code` (single-use code of a review link, `ttl` 10 min) | `review-code:<hash>` | SHA-256 of the code |
| `integration-discovery-cursor` (bounded source-outbox scan) | `integrations:worker` | `pending` |

Project feedback carries server-only synchronization versions, pending markers and indexed source
keys. A hard delete atomically writes a text-free `tombstone` in the same comments partition
(`$tombstone_<commentId>`, TTL 30 days). It is removed after each destination has durable deletion
work and never appears in comment lists or DTOs. See [the shared delivery contract](integrations.md).

Email goes through Azure Communication Services (`ACS_CONNECTION_STRING`, sender `UIER_EMAIL_SENDER`, both
set by Pulumi). Links in emails use `https://uier.io` in production and the deployment URL on previews
(`UIER_BASE_URL` overrides both); never the request's Host header.

App server actions validate positional arguments before use as well as checking the session and role.
Boolean settings are also validated by the services that persist them. Member removal compares the
loaded user id, then atomically updates the workspace removal version and deletes the versioned
member; concurrent removals recheck the admin count. A removed membership is never restored.
Sign-in return paths are rebuilt with `new URL()` against a fixed origin, restricted to `/app`
and its descendants, and reject dot segments (including encoded forms), backslashes and controls.

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
fixed `uier00000001` value is internal-only at the review API; copy its new link or script from the
app. The same-origin public showcase continues through `/api/comments`.

Deleting a project replaces its code and public id claims with retired claims that name no project.
Both ids then answer `404` and are never issued again ([project deletion](project-deletion.md)).

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

`pnpm build` in `apps/web` first copies the production bundle of `@uier/toolbar` (a workspace devDependency,
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
The SHA-256 path and SHA-384 integrity value are generated from the final CSS-inlined bytes by
the toolbar build (`@uier/toolbar/bundle`). `copy-toolbar.mjs` publishes identical bytes at the
default and pinned paths, plus a no-store `/toolbar/manifest.json` archive index.

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

On uier's own pages, Add comment also targets toolbar and inbox elements when the page and API
share an origin. Point mode selects the control without activating it; Cancel or Escape ends
placement. Keyboard reviewers can focus a control before using Add comment. These comments keep
their shadow-root anchors and capture the reviewed UI in screenshots. Third-party embeds keep
uier's own controls outside comment targeting.

## Comments API

[`apps/web/app/api/comments`](../apps/web/app/api/comments), implemented in
[`apps/web/src/lib/comments`](../apps/web/src/lib/comments). JSON in and out; comments are partitioned by the
public project (`project:uier00000001`, the Cosmos DB partition key `domain`) and stored per page path (without query string and
trailing slash).

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/comments?path=/x` | | `200` comments of the page, newest first (max. 200 and 1 MB), resolved ones included (`resolved: true`) |
| `GET /api/comments?scope=site` | | `200` comments of every page of the domain, newest first, with the same limits (the toolbar's inbox) |
| `POST /api/comments` | `{ path, position, kind?, text, quotedText?, device?, screenshot? }` | `201` the new comment, with `screenshot: { width, height }` when it has one (see [Screenshots](review-workflow.md#screenshots)). `kind` is `comment` (default; `position` is a point or a text selection), `rewrite` (a suggested replacement for selected text: `position` is a text selection, `text` the suggested text, `quotedText` the original), or `feedback` / `bug` with `position: { "type": "page" }` (about the page, no pin) |
| `POST /api/comments/{id}/replies` | `{ text }` | `201` the updated comment; anyone may reply |
| `PATCH /api/comments/{id}/replies/{itemId}` | `{ text, expectedText }` | `200` the updated thread; the message's author only. Includes the first message. A stale edit gets `409` and does not overwrite newer text |
| `PATCH /api/comments/{id}/anchor` | `{ path, position, expectedRevision }` | `200` updated thread; author only, exact saved page and validated element/text selector. `expectedRevision` is `anchorContext.revision` or `null`; stale anchors return `409` |
| `PATCH /api/comments/{id}` | `{ resolved }` | `200` the updated comment; author only |
| `GET /api/comments/{id}/screenshot` | | `200` the comment's screenshot (`image/webp`, `image/jpeg` or `image/png`), public like the comment; `404` when it has none |
| `POST /api/comments/{id}/screenshot` | `{ screenshot, expectedRevision }` | `200` updated comment; author only. `expectedRevision` is the current image revision, or `null` for an original/missing image; stale evidence returns `409` |
| `DELETE /api/comments/{id}` | | Deletes the first item; author only. `204` when the comment is gone, or `200` with the comment when other visitors replied (see below) |
| `DELETE /api/comments/{id}/replies/{itemId}` | | `200` the updated comment; author of the reply only. The first item is deleted as with `DELETE /api/comments/{id}`; `204` when the comment is gone |
| `GET /api/visitor` | | `200` `{ name }`: the visitor's guest name, `null` before their first write (the toolbar's profile) |
| `DELETE /api/visitor` | | `204`; signs out: removes the `__Host-uier_visitor` cookie (never creates one) |
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
[`pageState.ts`](../packages/toolbar/src/pageState.ts) contract (also exported as `@uier/toolbar/page-state`) normalizes
trailing slashes, percent encoding, query order and duplicate values. Hash-route prefixes are preserved so copied
links work with the site's router. Tracking, review activation and recognized credential/identity fields cannot
be selected. Values are limited to five per field, 128 characters each; emails, URLs, token-like values and common
credential hash routes are omitted. Choose only fields that never contain personal or secret values.
To help choose, a new project comment also stores `queryKeys`: the names, never the values, of up to 12 other
query fields on the page (search and hash-route query) that could be selected and had a value the policy would
keep. The toolbar sends them only while the page is still the comment's view, the API drops approved and invalid
names, and they are never part of a comment response; Settings → Page state suggests the most common ones from the
newest 200 comments, together with names in the stored path of older comments. Keys longer
than 2048 characters fall back to pathname; the public showcase keeps its existing 512-character pathname contract.

New project records have `pageStateVersion: 1`; their `path` is the canonical view key, used consistently by APIs,
queries, caches, inbox groups, app links and durable drafts. SPA push/replace, back/forward and hash changes update
the view without carrying placement controls or draft text onto another view. Old pathname records stay on the base
page and in the site inbox. The old query-string fallback applies only to legacy records, never to v1 views.
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
| Request body | 16 KB (`413`); a new comment with a screenshot about 700 KB |
| Screenshots | PNG, JPEG or WebP, 512 KB and 4096 px on a side; 300 per domain or project per day |
| Comment / reply text | 1-1000 characters after trimming, at least one visible character; bidirectional override characters are removed; quoted text up to 1000 |
| Path / selectors / selected text | 512 / 1024 / 2000 characters |
| Thread | 50 messages (replies are appended atomically) |
| New comments per visitor | 10 per hour |
| Replies per visitor | 30 per hour |
| New comments per project member | 100 per project per hour; public feedback commenters keep 10 |
| Replies per project member | 300 per project per hour; public feedback commenters keep 30 |
| Replies per MCP connection (access token or connected app) | 30 per project per hour, also counted against the owner's member budget |
| Writes per IP (an IPv4 address or an IPv6 /64) | 30 per domain or project per hour for guests and public feedback commenters; project members do not consume it. The anonymous `/api/comments` API keeps this limit for every writer |
| New comments per page | 100 per day (`reason: page_full`) |
| Rewrite suggestions | 20 per visitor (with the cookie) or project reviewer per hour, 300 per domain or project per day; app-wide, whatever the site: 40 per IP per hour and 1000 per day; selected text and each suggestion up to 1000 characters (what a rewrite comment holds), instruction up to 300 |

**Bot protection: [Vercel BotID](https://vercel.com/docs/botid)** (basic mode, no captcha).
[`instrumentation-client.ts`](../apps/web/instrumentation-client.ts) attaches the BotID challenge to the page's
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

**Storage.** Screenshot bytes use private Azure Blob Storage; Cosmos retains small references. Authorized
new toolbar clients receive a 60-second single-image read URL, while older clients retain the image response.
See [screenshot storage](screenshot-storage.md) for environments, CSP, migration and cleanup.

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
[`infra/src/index.ts`](../infra/src/index.ts) is updated.

`COSMOSDB_COMMENTS_CONTAINER` selects the container (default `comments`). All of these variables are managed by
Pulumi (see [Infrastructure](operations.md#infrastructure)).

## Rewrite suggestions

The toolbar's **Rewrite** action (selected text) can ask for AI suggestions: `POST /api/rewrite` (a project's
toolbar: `POST /api/review/<code>/rewrite`) ([`src/lib/rewrite/suggest.ts`](../apps/web/src/lib/rewrite/suggest.ts)) calls the Anthropic API with the official
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
([`e2e/support/anthropicStub.ts`](../apps/web/e2e/support/anthropicStub.ts), started by `playwright.config.ts` on
`PORT + 1000`), which checks each request and answers with canned suggestions.
