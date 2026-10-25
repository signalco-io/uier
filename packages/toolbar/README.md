# @uier/toolbar

The uier toolbar: a comments overlay that is injected into a page, so visitors and teammates can leave
feedback pinned to an element (point comments) or to selected text.

## Embedding

The bundle (`dist/index.js`) is a classic script (an IIFE, so nothing leaks into the page's globals).
The web app serves it at `/toolbar.js`; the production URL is `https://uier.io/toolbar.js`, served from
Vercel's CDN (caching and updates: the root README, [`/toolbar.js`](../../README.md#toolbarjs)). A reviewed
site embeds it with its project's script tag from the uier app's install guide:

```html
<script src="https://uier.io/toolbar.js" data-uier-project="k3m9x2p7q4ab" defer></script>
```

and the toolbar starts on a page opened with a review link: `?toolbar-code=<project code>`, the links the
app gives out, or `?review=true` ([Review links](#review-links)). The comments and settings that apply are
those of the script's project, `data-uier-project` ([Projects](#projects)). The uier.io landing page uses
showcase mode and no project:

```html
<script src="https://uier.io/toolbar.js" data-uier-mode="showcase" defer></script>
```

Cross-site embeds require a project. Without one, `/api/comments` uses the static public project for the same-origin showcase on
uier.io. Local subdomains keep separate host partitions. Failed comment loads show a message and a retry action.

Configuration is read synchronously while the script runs (`src/config.ts`), from the script tag's data
attributes or from `window.uierConfig`, set before the script:

```html
<script>window.uierConfig = { mode: 'showcase', apiUrl: 'https://uier.io' };</script>
```

| Option | Script attribute | `window.uierConfig` | Default |
| --- | --- | --- | --- |
| Mode | `data-uier-mode` | `mode` | `review` |
| API base URL | `data-uier-api-url` | `apiUrl` | origin of the script URL |
| Project | `data-uier-project` | `project` | none (comments per domain) |

### React

`@uier/toolbar/react` (`src/react.ts`, built to `dist/react.js`) adds the same script tag from a React app.
Render it once, for example in the root layout; it renders nothing itself:

```tsx
import { UierToolbar } from '@uier/toolbar/react';

<UierToolbar project="<project code>" />          // a reviewed site: review mode, https://uier.io/toolbar.js
<UierToolbar mode="showcase" src="/toolbar.js" /> // how uier.io public pages embed it
```

Props: `mode` (`review` or `showcase`), `project` (`data-uier-project`), `src` (script URL, default
`https://uier.io/toolbar.js`) and `apiUrl`.

`openUierFeedback({ project, src, apiUrl })` opens the toolbar's feedback form from a button of your own
(uier's app has "Give feedback" in its sidebar). A toolbar already on the page opens its form; otherwise the
first call adds the script in `feedback` mode. A reviewed site passes its project code from the app's install
guide; without it, comments can't load or post there (see above). The package is part of this repository
and not published to npm yet.

### Review links

In `review` mode the toolbar mounts only when the page is opened with a review link:

| Link | Review |
| --- | --- |
| `https://example.com/any/page?toolbar-code=<project code>` | a project's review link, as the uier app makes them (the code: letters, digits, `-`, `_`, up to 64) |
| `https://example.com/any/page?review=true` | a review link without a project code |

A review link only starts the review. The project whose comments and settings apply is the script tag's
`data-uier-project`; the app's links carry the same code (`?toolbar-code=<data-uier-project>`), and
`?review=true` on a project's site reviews that project too. "View project" opens the reviewed project in
the app (`<API base URL>/app/projects/<code>`): the script's project, else the link's code. Without a
project in the script tag, comments are stored per domain.

The review then lasts for the browser tab (`sessionStorage`, key `uier:review`): it continues on the site's
other pages, including full page loads without the parameter, until the reviewer chooses **Exit review**,
which removes the toolbar and the review parameters from the address. A code that is not a valid project
code starts nothing (`src/review.ts`).

### Projects

The uier app's install guide gives each project its script tag, with the project code:

```html
<script src="https://uier.io/toolbar.js" data-uier-project="k3m9x2p7q4ab" defer></script>
```

With a project the toolbar uses the review API, `<API base URL>/api/review/<project>`, instead of
`/api/comments`. The project's "who can comment" setting applies (`src/project/`):

- **Invited people**: the pill says "Sign in to see and leave comments". Sign in opens the project's review
  link on uier (`/app/review/<project>?url=<this page>`), which signs the reviewer in and comes back with
  `?toolbar-code=<project>&uier-token=<single-use code>`. The toolbar exchanges the code for a review token
  right away and removes it from the address. The token is kept in the site's `localStorage`
  (`uier:review-token:<project>`, 30 days) and sent as `Authorization: Bearer`.
- **Anyone with the link** (guests): anyone with a review link comments. The first comment asks for the
  guest's name (`uier:guest-name`); a random visitor id (`uier:visitor`, sent as `X-Uier-Visitor`) recognises
  their comments. No cookies are used: the API is on another site than the reviewed one.
- **Comments off**: the pill says "Comments are turned off for this project".

On a site that is not one of the project's addresses, the pill says "uier can't open this project here". In
`review` mode each of these pills also has **Exit review** (an X button), so a reviewer who can't comment
can still end the review.

Members mark any comment done; the author and the project's admins delete it (the API returns
`permissions` and `canDelete`, and the thread shows only those actions). The profile shows the member's
account name or the guest's name; Sign out forgets the token, name and visitor id on this site.
`?uier-comment=<comment id>` (from "Link to comment" in the app) opens that comment's thread. The API only
answers the project's own site addresses (CORS), so the script works only on those sites. Sites with a
Content-Security-Policy add the sources from the install guide's "Advanced" section, including uier's
origin in `frame-src`. Before a cross-origin write, an empty frame on the API's origin runs BotID and
returns a signed proof bound to the origin, project and reviewer. The toolbar caches it only in memory
for under five minutes and sends it as `X-Uier-Verification`. No third-party cookies are needed.

### Modes

- `review` mode mounts the toolbar only for a review (see above).
- `feedback` mode mounts it when the page asks for feedback: when the script loads, and again on every
  `uier:open-feedback` event on `window` after **Close toolbar** (in its options) removed it. It mounts
  with the feedback form open; a toolbar already on the page opens its form on the same event
  (`src/openFeedback.ts`).
- `showcase` mode (uier.io public pages) always mounts it and shows a dismissible first-run hint above the
  toolbar (dismissal is remembered in `localStorage`, key `uier:showcase-hint-dismissed`; the "About uier"
  button shows it again). The hint also closes, and stays closed, once the visitor starts a comment.
- The API base URL defaults to the origin of the toolbar script (`document.currentScript.src`), so a
  preview deployment's toolbar talks to that preview's API. When there is no script URL (e.g. loaded as a
  module script), the build-time `__UIER_API_URL__` is used (`https://uier.io`). The development build
  always uses `__UIER_API_URL__` (`http://localhost:4004`), because the toolbar dev server only serves the
  bundle.

## Comments API

`src/hooks/useComments.tsx` calls `<apiUrl>/api/comments` with `credentials: 'include'`; the API identifies
anonymous visitors with its HttpOnly `uier_visitor` cookie. Comments are public: every visitor sees the
unresolved comments of the page (`?path=` is `location.pathname` without a trailing slash) and can reply;
in a review the inbox also lists the site's other pages (`?scope=site`). Project settings can opt in to meaningful
query fields and `#/...` / `#!/...` routes. The shared `src/pageState.ts` contract filters reserved/credential and
tracking fields, bounds values and produces the same canonical page key in the browser and API. Older records keep
pathname identity; v1 view records never use the legacy query-prefix fallback. Routing settings do not rewrite old
feedback. Direct links to an earlier view setting restore the URL and show its saved details in the inbox.
Only the author of a comment can resolve, reopen, edit or delete it, and only the author of a reply can edit or delete
that reply (the API returns `isMine` / `author.isMe`; project members also receive explicit edit/delete permissions,
including workspace admin rights). Editing uses `PATCH .../replies/<itemId>` with the text and its original
`expectedText`; a stale edit returns `409`. Save and Cancel preserve the thread and original screenshot/context,
and failures keep the attempted text. Saved edits show an edited label. When others replied, deleting a comment keeps the
thread: its first item comes back as `{ deleted: true }` and shows as "Comment deleted", without author or
actions. Deleting asks first and says what will go. Texts are limited to 1000 characters. API errors
(`rate_limited`, `too_large`, `bot_detected`, ...) are shown as friendly inline messages
(`src/components/CommentsErrorMessage.tsx`); a `rate_limited` body's `reason` tells a full page
(`page_full`) from a visitor who sends too fast (`too_fast`, also when `reason` is missing), and
`Retry-After` gives the wait. `GET` lists at most 200 comments, so a full list shows as "200+".

Stored positions are untrusted (anyone can post one): an invalid selector or an out-of-range offset
resolves to "not on this page" (`src/hooks/useCommentItemRects.tsx`), and every comment renders inside an
error boundary, so one bad comment never breaks the toolbar.

## Using it

- The pill sits at the bottom centre: add comment, feedback, inbox, profile, options and collapse. **Collapse** shrinks it
  to the uier mark (with the unread count) and hides page pins, text highlights, comment popovers and inline threads. Point mode
  ends, and selecting page text shows no review controls while collapsed. **Expand** restores the annotations
  at their current positions; unsent comment and reply text is kept. The state is kept for the tab
  (`uier:toolbar-collapsed`), including after navigation and reload. The inbox keeps its state; **Show on page**
  expands the toolbar before opening a comment's pin.
- Drag the **Move toolbar** handle with a mouse or touch to reposition the pill, including while collapsed.
  Arrow keys move it (Shift moves farther), Home resets it, and Options offers **Reset toolbar position** after
  a move. The centre is saved per site/browser in `localStorage` (`uier:toolbar-position:v1`), then clamped to
  the visible viewport on resize, orientation changes and on-screen keyboard changes. Controls remain
  horizontally scrollable on narrow screens. Dragging does not start from action buttons.
- The inbox uses the shared `DockablePanel` shell: 320px wide from 640px, 400px from 1280px. Drag the handle
  beside its heading toward either side, or use left/right arrow keys on it. The destination is shown before
  dropping; canceled drags keep the old side. The panel slides in from its side (it only fades with reduced
  motion). Each panel saves its own side (`uier:panel-side:v1:<id>`). Moving keeps content, filters and scroll
  state; narrow screens use a full-width inset panel and retain the preferred side for wider screens.
- **Profile** shows the visitor's guest name (`GET /api/visitor`). **Options** lists what applies: View project
  (a review of a project's site, or a review link with a project code), Exit review (`review` mode) and Sign out (`DELETE /api/visitor`, asks
  first: the comments stay, but this browser can no longer resolve or delete them).
- Feedback and bug reports: the megaphone opens a dialog to choose feedback (heart) or a bug report (bug) and
  describe it. It is saved as a comment of that `kind` about the whole page (`position: { type: 'page' }`):
  no pin, but it is counted and listed in the inbox like any thread.
- Point comments: the + button starts point mode (a pin cursor and an instruction above the pill, Esc
  cancels). The element under the pointer gets a dashed accent outline, drawn by the toolbar over it (the
  page's own styles are not touched, and the toolbar's controls are never outlined); a click pins the comment. With the keyboard, focus an element on the page, Tab to the + button and press
  Enter: the comment is pinned to that element (Enter on a focused element in point mode does the same).
- Rewrite suggestions: select text, then **Rewrite**. The text box starts as the selected text, to edit into
  your version; **Suggest** (optionally with an instruction such as "shorter") asks `POST /api/rewrite` for AI
  suggestions, and picking one replaces the text as if it was typed (Ctrl/Cmd+Z brings yours back; a guest's
  name stays). **Post suggestion** saves a comment with `kind: "rewrite"`, shown as "Suggested rewrite" with the
  original quoted. Suggestions are offered for selections of up to 1000 characters (what a comment holds). When
  the model declines, the toolbar says "No suggestions for this text."; when suggestions are not available (no
  API key, `503`) or limited (`429`), it says so, and your own version still works. Closing an unchanged rewrite
  leaves nothing behind. The selected text toolbar (Add comment, Rewrite) is one Tab stop; the arrow keys, Home
  and End move between its buttons.
- Text comments: select text, then **Add comment** in the toolbar that appears next to the selection. The
  comment stores the selected text and where it is: the start and end elements and character offsets in
  all of their text (so text after a link or bold words inside a paragraph is found again).
- Restoring: pins are placed at their elements and commented text is tinted; clicking the tint opens the
  thread too. Positions are measured again when the page scrolls (also inside scrollable elements),
  resizes or changes (`hooks/useLayoutVersion.ts`). When the stored offsets no longer point at the text,
  it is searched for (ignoring whitespace) in its element, then its ancestors. When it is not on the page
  anymore, a fallback pin goes on the closest element that still is, and the thread says so. Anchors that
  are hidden (e.g. in a closed `<details>`) get no pin until they are shown.
- Screenshots are captured automatically when a new element/text comment, rewrite, feedback or bug report starts.
  There is no camera button or preview while writing. Posting waits for that capture attempt (up to 15 seconds);
  a failed capture still saves the text. Reopening or restoring a draft refreshes its capture and viewport from the current page, and
  discarding it saves no image. Replies and edits keep the original screenshot. Saved threads and the inbox
  show a small thumbnail; click, tap or press Enter to expand it, and close to return focus to the thumbnail.
  Capture excludes the toolbar and inline review threads; DOM/CORS limitations remain in
  [Screenshots](../../README.md#screenshots).
- Every comment saves the device size, viewport and supported browser/OS hints when feedback starts (`getDeviceInfo`).
  Public and guest threads show only size and viewport ("Desktop · 1280×720"). Authorized project members also get
  expandable/copyable reproduction details: browser/version, OS, pixel ratio, original capture time and a safe page
  link. Unsupported/older fields stay Unknown or Unavailable. Links include only stored, approved page state;
  tracking, credential and review-token fields are excluded. Resizing, replying and editing do not replace the original context.
- The text box grows with the text; Enter posts, Shift+Enter adds a new line. Unsent text is kept when the
  popover closes (a new comment stays as a draft pin until it is posted or discarded).
  Comments, replies and feedback are sent in the background: the form empties at once and the comment or reply
  shows straight away (a pending pin reads "Comment, sending" and counts only saved messages; its thread opens
  once it is saved, and replies to it wait for its id). The text stays with the draft until the send settles, so
  leaving or reloading the page meanwhile keeps it. A failure removes the comment or reply, puts the text back in
  the draft (a new comment's draft pin returns with the reason) and says so in a toast. Edits still wait for the save.
  Seven-day browser-local text/anchor drafts are scoped to the API, project, authorized reviewer, canonical page and item. Reload/navigation restores the draft; Discard, successful posting and toolbar sign-out clear it. Images are never stored with drafts. Blocked/full storage falls back to memory with a notice. See [Draft recovery and submission retries](../../README.md#draft-recovery-and-submission-retries) for expiry and idempotent create/reply behavior.
- After posting, the new comment's thread opens with the focus in its reply box, and "Comment posted" /
  "Reply posted" is announced. Escape closes the thread and the focus goes to its pin.
- A thread starts with its status (**Open** or **Done**) and public id (`#12`, numbered per site), **Mark as
  done** / **Reopen** for the comment's author, and **Copy link** for everyone. The link is the comment's page with `?uier-comment=<id>` (plus the review
  link in a review, so the toolbar opens for whoever follows it); opening it opens the thread on its pin, or
  the inbox for a done thread or feedback. The parameter is then removed from the address. Done threads have
  no pin; the inbox lists them under "Done".
- The inbox (the pill's inbox button opens and closes it; Esc and the close button close it too) lists
  **This page** and the site's **Other pages** (`?scope=site`), newest first.
  **Open**, **Done** and **All** filter by status, and the search box matches messages, quoted text, guest
  names, page paths and public ids. A thread shows its first and last message; **Show all** shows the rest.
  **Show on page** (only while the comment's pin can be placed) opens an open comment's thread on its pin; a
  comment on another page links to its thread there (`?uier-comment=`, always on this site). The status and
  search are kept while the inbox is closed; Escape clears a search first. The showcase includes other public pages too.

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

## UI and styles

- `src/index.tsx` mounts the toolbar into an open shadow root on `<div id="uier-toolbar">` (open so
  assistive technologies, accessibility checks and end-to-end tests can reach it; the page's own scripts
  and styles can't change it by accident either way). Everything, popovers included, renders inside it and
  the toolbar adds no styles to the page (`apps/web/e2e/embed.spec.ts` checks a reviewed site's computed styles).
- Styles are compiled with Tailwind CSS v4 (`src/index.css`, `postcss.config.mjs`) and inlined into
  `dist/index.js` at build time (see `tsup.config.ts`, placeholder `__uier_toolbar_css__`).
- Colors come from `@uier/brand/tokens.css`. The pill, the pins and the inbox sidebar are always ink
  (`src/components/InkScope.tsx`); thread popovers and the hint follow the system light/dark theme.
  `src/styles/toolbar-theme.css` keeps the page's inherited text styles out and honours reduced motion.
- UI components come from the `@signalco/*` UI kit; `src/styles/tailwind-v3-compat.css` keeps the kit's
  Tailwind v3 class names rendering as they did with Tailwind v3.

## Scripts

- `pnpm build` - production bundle in `dist/index.js` (CSS included) and the React component in `dist/react.js`
- `pnpm dev` - rebuild on change and serve `dist` on http://localhost:4005 (loaded by `apps/web` in development)
- `pnpm typecheck` - type check with `tsc`
