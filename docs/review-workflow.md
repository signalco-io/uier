# Review workflow

Reference for the app, project access and feedback behavior. To embed the toolbar on your site,
see the [toolbar guide](../packages/toolbar/README.md).

## The app (`/app`)

The signed-in app at [uier.io/app](https://uier.io/app) ("Get started" on the landing page), in
[`apps/web/app/(rest)/(app)`](../apps/web/app/(rest)/(app)) with its logic in
[`apps/web/src/lib/app`](../apps/web/src/lib/app). Pages are server components; changes go through server
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
  The code works only in the browser that requested it, using the signed HttpOnly `__Host-uier_sign_in_request`
  cookie (SameSite=Lax, Secure outside local development). It expires with the request and is removed on
  sign-in. A new request in that browser replaces its binding. Type the code only where you asked to sign
  in and never share it. Invitations keep their seven-day links.
  Five wrong codes invalidate the request, including its link. Atomic counters reserve at most five guesses
  before comparison, with no window reset during the request. Rejected browser bindings do not count against
  another request. Sign-in emails remain limited to 5 per address and 20 per IP per hour, so new requests
  cannot bypass the email limits. Locally and on previews, the page shows both the link and code.
  The first sign-in creates the account. Opening the link shows a "Continue" button, because email scanners
  open links before people do. The session is an HttpOnly `__Host-uier_session` cookie with a signed token (30 days;
  the key is derived from the server secret, like guest names). Signed-out visits to an app page return there
  after signing in (`proxy.ts`, `?next=`), including the toolbar's project review link.
- **Workspaces**: every user gets a workspace of their own on first sign-in and is its admin. Projects and
  members belong to a workspace; with more than one workspace the menu at the top of the sidebar switches
  between them. A new workspace is named after its creator's email until an admin renames it in the
  workspace settings. The workspace and its admin are created together, so a creator whom an admin removed is
  never added back by opening the app again: with no other workspace, they get a new, empty one of their own.
- **Projects** (`/app/projects`): one project per reviewed site, with its addresses (the main site first,
  then staging or preview addresses), its status (active or done) and who can comment. The page shows the
  active or done projects as cards with their open comments, who can comment and review links.
  An optional client name (up to 80 characters, with whitespace normalized) can be set at creation or
  in settings; the field suggests the existing clients as you type, and any other name adds a new one. It
  appears with the client's tile in project details and cards. The client filter sits beside Active/Done,
  offers All clients and No client, and stays selected in the URL (`?client=<client id>`) across status
  changes, reloads and renames. Links from before clients had ids (`?client=name:<name>`) open the id link.
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
    every address, main site first. Comments-off projects say so and link admins to Settings. The install
    guide on its own (from the empty comments list or Settings → Installation) has no progress or reviewer step.
  - A project has a header (name, client, who can comment, Open review and a Settings button) above
    its comments. Open review lists every address (main site first) to review or visit. Hovering or clicking
    who can comment shows more info and, for admins, Invite; in guest mode that includes the guest links for every address.
  - Comments `/app/projects/<code>`: the project's **comments**, as a
    list or a board (Open / Done), filtered by people (all, assigned to me, opened by me) and by environment and page in one control
    (environments on the left, that environment's pages on the right: a relative URL, or a section such as `/blog/*` for every page under it). The list shows open comments; its status filter (the toolbar inbox's Open, Done and All, with
    counts) shows closed ones. Done and Reopen fade a comment out of a list it no longer matches. Each comment is laid out like the toolbar's thread: its state, `#number` and unread dot with the
    actions (Mark as read, Done or Reopen, Copy issue, Copy link and More) on top, then the assignee
    ("Unassigned", or a menu of people for those who can assign) and its source, the first and last message
    with Show all for the rest, the quiet Follow thread and Open in a connected service, and its page URL at
    the bottom. Two icons after the first message's time show the screen size and browser it was left from;
    hovering or clicking them shows the viewport, pixel ratio, browser, OS, capture time and reviewed page,
    with Copy reproduction details for the same fields as text. The author or an admin edits and deletes it, and only admins make it
    private. The Unread filter is the inbox's chip: a blue dot and count. Empty lists retain Install the script; invited-only projects
    also offer admins Invite with the email sign-in explanation. Comments-off lists say so and link admins
    to Settings. Filtered lists keep Nothing here.
  - Install `/app/projects/<code>/install`: the install guide with the public project code and **Check installation**.
    The check opens the actual configured site, confirms the script's project/API, reads comments and obtains a
    browser-verification proof without posting a test comment. CSP failures are diagnosed where browser evidence
    exists; missing scripts, private/unreachable sites, changed origins and interrupted checks stay inconclusive.
    Reports check the window, origin and a temporary nonce; no tokens, reviewer identity or page content are reported.
  - Settings `/app/projects/<code>/settings`: everyone mutes or unmutes their own project emails there. Admins
    also set the name, optional client name, who can comment (invited people, anyone with the link, or comments
    off), addresses, meaningful page-state fields, and see usage (comments, open, done, replies, pages, people
    with access) and done.
  - Review links `/app/review/<code>?url=<page>&comment=<id>` check access and redirect to the page with the
    toolbar's review link parameter `?toolbar-code=<publicId>`, a single-use code that signs the toolbar in
    (`uier-token`) and the comment to open (`uier-comment`); only addresses of the project are redirect
    targets.
  - Project embeds also try background sign-in through the hidden `/review-session` frame. A signed-in
    member can start reviewing a configured site without a link or top-level navigation. The separate
    `__Secure-uier_review_sso` HttpOnly, Secure, SameSite=None cookie only authorizes project review handoffs;
    the app session stays SameSite=Lax. Existing logins receive it on their next app visit. Browsers that
    block cross-site cookies or frames keep the explicit link flow. No storage-access prompts are opened.
    Toolbar sign-out disables automatic sign-in on that site until an explicit authenticated review link;
    Exit review suppresses automatic opening in that tab. Pending one-use codes survive host redirects
    in session storage for at most ten minutes and are removed after exchange or definitive rejection.
- **Clients** (`/app/clients`): the clients of the projects the member can see, each with its tile (an icon
  or its first letter, on its colour), description, projects and how many are active or done. A client
  opens the projects list filtered to it (its done projects when none is active). Admins edit a client
  there: its name, a short description (up to 280 characters), one of twelve icons and a colour from the
  brand tokens (blue, green, amber, red, or ink). A client is a record of the workspace and projects point
  to it, so a rename shows on every project at once. Names stay unique in the workspace: a rename to
  another client's name is refused while that client has projects. A client with no projects left is no
  longer shown; a project that names it again gets it back with its details, and a rename can take its name.
- **Users** (`/app/users`, admins only): the people in the workspace with their role (admin or commenter)
  and the projects they review, filtered by project (`?project=`), and the pending invitations. Admins
  remove people (the last admin stays), including the person who created the workspace, and revoke
  invitations. A removed member's review token stops working at once, because the review API checks the
  membership on every request.
  - Invite (a dialog from the users page, a project's header (in who can comment) or its card menu): the email, the role and,
    for commenters, the selected projects or all projects. The email links to `/app/invitation?token=` (single use, 7 days,
    stored only as a SHA-256 hash; 50 invitations per workspace per day). Inviting the same address again
    replaces the earlier invitation. Accepting takes a click, like signing in: it signs the invited person
    in (their account is created on first use), adds them to the workspace and opens the project's review
    link, or the projects when the invitation has no project.
- **Workspace settings** (`/app/settings`, admins only): the workspace name (up to 80 characters, on one
  line), which everyone in the workspace sees in the workspace menu and when they connect a coding tool.
  Admins open it from the workspace menu at the top of the sidebar or from the sidebar's sections. The uier
  workspace that everyone joins for feedback on the app has no settings page.
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

See [the delivery contract and operations guide](review-notifications.md) for defaults,
verification, retention, retry evidence, scheduler delays and the #83/#91 integration contract.

## Landing page showcase and public feedback

Every public page embeds the toolbar from the marketing layout in **showcase** mode:

```html
<script src="/toolbar.js" data-uier-mode="showcase"></script>
```

([`ToolbarScript`](../apps/web/src/components/toolbar/ToolbarScript.tsx), which renders the toolbar's React component
`<UierToolbar mode="showcase" />` from `@uier/toolbar/react`). The toolbar
is always mounted on public pages, and the landing page shows a dismissible first-run hint (with About uier to reopen it); anonymous visitors can leave point comments,
text-selection comments and replies. **Feedback is public**: every visitor sees every unresolved comment on
the page and can reply to it. Embedding options and the toolbar's modes are described in
[`packages/toolbar/README.md`](../packages/toolbar/README.md).

The static project `uier00000001` and workspace `w_uier_public` are created in the deployment's
`app` container on the first public API request. The two starter threads are created in `comments`
with stable ids and `ttl: -1` (no expiry). Project and thread provisioning is create-only and safe across concurrent
cold starts: it preserves replies, status and numbers. Production feedback previously stored under
`uier.io` is copied once, with a persistent migration receipt; source records remain untouched.
Previews use only their configured preview containers. Local subdomains keep independent, unseeded
partitions for testing.

Every uier account automatically joins this workspace. Only accounts in the server-side
`UIER_STAFF_EMAILS` allowlist are admins (`projects: all`); everyone else is a commenter of the
feedback project, including former staff and admins previously set by hand. Existing accounts are
enrolled by a one-time, resumable provisioning backfill; sign-in and app requests reconcile roles.
Each server instance also resets stored admins on its first public-project provisioning call.
Review tokens and MCP connections (access tokens and connected apps) recheck the allowlist at read time, before that stored reset.
This grants project access directly, with no invitation email or acceptance step, and keeps each person's current workspace
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

## Screenshots

Every new element/text comment, rewrite, feedback and bug report starts a screenshot automatically
([#81](https://github.com/signalco-io/uier/issues/81)). There is no capture button or image preview in the composer.
Submitting waits for the capture attempt, with a 15-second limit; failures keep the text and show an unavailable
image state on saved feedback. Image-capacity or image-storage failures also preserve the text. Images are saved only with successfully posted feedback. Replies keep the original
capture. Saved inbox entries and comment details show thumbnails that expand on click, tap or keyboard activation.

The toolbar draws the capture in the reviewer's browser
([`packages/toolbar/src/screenshot.ts`](../packages/toolbar/src/screenshot.ts), with
[`modern-screenshot`](https://github.com/qq15725/modern-screenshot)), without the toolbar or inline review threads,
cut to the element/text with some room around it (the window for page feedback), as WebP (JPEG where unavailable)
of at most 480 KB.
Images, fonts and stylesheets from other sites that don't allow it (CORS, or the site's CSP `connect-src`),
images that haven't loaded within a second (lazy ones below the window), `<canvas>`, video, iframes and
`backdrop-filter` come out empty or plain.

For missing or unsuitable captures, the author (or a workspace admin) can choose **Upload image** or
**Paste image** on saved feedback in the toolbar: beside "No screenshot", or in the expanded screenshot next
to Redact screenshot. Keyboard image paste also works while a saved image control has focus. PNG, JPEG and WebP images use the same 512 KB / 4096 px limits as automatic evidence;
invalid images and denied clipboard access show an error and keep the saved feedback. Nothing is previewed
in a composer. Images are not persisted with drafts or in browser storage.

Expand the saved thumbnail and choose **Redact screenshot** to cover content with opaque black rectangles.
Drag with a mouse/touch, or enter left/top/width/height percentages and add an area using the keyboard.
Undo and cancel affect only the editor. **Save redaction** flattens the masks into a replacement image.
Upload, paste and redaction upload a new immutable Blob, then use an authorized, conditional transaction
to swap the image reference and comment metadata together. The previous bytes remain until success, then are deleted;
the API exposes no image history. Failed or unconfirmed saves report an error; reload to check an uncertain
network result. Image revisions prevent stale replacements. These actions count against the existing daily
image budget. They cannot erase copies someone already downloaded.

It is sent with `POST /api/comments` (or the review API) as `screenshot`, a data URL; the body of a new comment
may then be up to about 700 KB. The server checks the image type and header dimensions, then decodes
with a 4096² pixel limit and re-encodes only the first frame without metadata or trailing bytes.
Undecodable images are rejected. Newly encoded PNG, JPEG or WebP output must stay within 512 KB
and 4096 px on a side; an oversized PNG is retried as WebP. Binary bytes live in private Azure Blob Storage,
with a small reference stored in the comment’s partition
(`type: 'screenshot'`, id `$screenshot_<comment id>`, which no route accepts, with the comment's `ttl`); the comment
keeps `screenshot: { contentType, width, height, bytes, revision? }`. Authorized viewers request the image through
`GET .../comments/<id>/screenshot` (the toolbar fetches it when the thread shows it, in the inbox as it scrolls into view); the app shows it on the comment
(`/app/projects/<project>/comments/<id>/screenshot`). New clients download directly from Blob Storage with a
read-only, single-image URL valid for 60 seconds; existing clients and inline images retain their API response.
There is no CDN. A previously issued URL can remain usable for up to 60 seconds after a permission change.
See [storage, migration and deployment](screenshot-storage.md), including the updated embed CSP source. It is deleted with the comment, or with its author's text
when others replied. Failed image deletes are retried by the scheduled worker once an unreferenced
image is older than one hour. The sweep pages over image metadata and conditionally deletes the
observed version, preserving concurrent replacements. Migrated public-feedback deletes and image
replacements also remove their obsolete legacy copy. A site gets at most 300 screenshots a day.

## Draft recovery and submission retries

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

## Unread review activity

The toolbar's blue badge counts unread threads across all of the site's authorized comments. Open/Done
counts remain separate. The Unread filter includes all statuses and pages. Opening a visible short
thread acknowledges it after 800 ms in a focused foreground window; inbox previews and longer
collapsed threads require **Mark as read**. Reading never resolves feedback, and resolving never
acknowledges it. The app shares the same member cursor and offers Unread / Mark as read.

**Mark all as read** in the app comments list/board or toolbar inbox acknowledges only the
unread threads shown by the current filters. Replies arriving after that list was rendered stay
unread. Large lists are sent in batches of up to 200; failed writes offer Retry. Read activity
also suppresses pending email digests through the same per-reviewer cursor.

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

## Missing anchors and reattachment

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

## Feedback environments

Project settings → Environments labels each configured **origin** (scheme, host and port).
Addresses with different paths on one origin share an environment. Different origins are isolated
by default, including older unlabeled projects: their origin is the label. Admins can set an
identical, case-sensitive alias group on equivalent origins to share feedback for matching canonical
page views. A label alone never groups addresses. Grouping changes the view; it does not copy or
migrate comments, change permission checks, or rewrite their source origins.

The toolbar's pins follow the current environment or explicit alias group. Its inbox picks the environment
in the same location picker as its pages (All environments by default). Counts/unread and bounded lists use the
same server-side scope. Selecting another environment changes the inbox, while new feedback is
still recorded on the site being reviewed. The filter is saved on that site for the API, project
and reviewer in `uier:environment:v1:<api>:<project>:<reviewer>` until browser data is cleared.
App filters are retained in the URL and survive reload. The app and the toolbar inbox initially
show All environments (toolbar pins still show only the current origin). Invalid/stale selections
fall back to that default. Direct comment links open the original configured origin and stored safe query/hash
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

## Copy feedback as an issue

Saved thread details in the toolbar and app offer **Copy issue**: exact saved feedback, quotes,
anchor, permitted links, original permitted browser context, discussion and protected screenshot
references in one Markdown packet. Clipboard failures offer selectable Markdown. This is an explicit
export; it does not publish to a tracker. The shared versioned model and access rules are documented
in [Feedback context](feedback-context.md).
