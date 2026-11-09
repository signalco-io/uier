# @uier/toolbar

The uier toolbar: a comments overlay that is injected into a page, so visitors and teammates can leave
feedback pinned to an element (point comments) or to selected text.

## Embedding

Browser support follows the latest two stable major releases of Chrome, Edge, Firefox and Safari,
including Safari on iOS. The shared policy is [`.browserslistrc`](../../.browserslistrc); the toolbar
and website build from it. Run `pnpm -C packages/toolbar exec browserslist` at the repository root
to see the versions resolved by the locked browser data. Older browsers receive no polyfills.

The loader (`dist/index.js`) is a small classic script. It downloads the separate review script only
when a review starts, a signed-in project member is confirmed, showcase mode is enabled, or feedback
is requested. React, styles, screenshots and fonts load with the review UI. Ordinary visitors receive
only the loader and the bounded background account check.
The account check uses only the member token; guest identity is created by the review UI.
The web app serves it at `/toolbar.js`; the production URL is `https://uier.io/toolbar.js`, served from
Vercel's CDN (caching and updates: [`/toolbar.js`](../../docs/api.md#toolbarjs)). A reviewed
site embeds it with its project's script tag from the uier app's install guide:

```html
<script src="https://uier.io/toolbar.js" data-uier-project="V1StGXR8_Z5jdHi6B-myT" defer></script>
```

Copy the public project code from the install guide: a random 21-character Nano ID, separate from
the internal database id. Existing random 12-character codes remain supported.

**Pin this version** in the install guide provides HTML and Next.js snippets using
`/toolbar/<sha256>.js`, `integrity="sha384-..."` and `crossorigin="anonymous"` (`crossOrigin` in JSX).
Copy the complete snippet; the hash and integrity value describe that exact build. The default
`/toolbar.js` follows releases with a five-minute browser cache and one-hour CDN cache. Pins use
`Cache-Control: public, max-age=31536000, immutable` and the same API origin as the default embed.
Pinned production bundles remain available and compatible with the review API for one year after
their last release as the current version. Each loader references its exact review script by a
content-addressed path and integrity value; both assets are retained together. A pinned site gets
fixes only when it updates its snippet.
Preview/local pins belong to that deployment; they carry no production retention promise.

The toolbar opens automatically for signed-in project members when background authentication is available.
Otherwise it starts on a page opened with a review link: `?toolbar-code=<project code>`, the links the
app gives out, or `?review=true` ([Review links](#review-links)). The comments and settings that apply are
those of the script's project, `data-uier-project` ([Projects](#projects)). The uier.io landing page uses
showcase mode and no project:

```html
<script src="https://uier.io/toolbar.js" data-uier-mode="showcase" defer></script>
```

Cross-site embeds require a project. Without one, the toolbar shows **Open install guide** before
sending any comments or visitor request. It opens the review link's project's install page, or
`/app/projects` when the link has no code, on the API base URL in a new tab. Same-origin embeds
still use `/api/comments` for the public showcase on uier.io. Local subdomains keep separate host
partitions. Failed comment loads of configured projects show a message and a retry action.

On uier's own pages (the page and configured API share an origin), Add comment can also target
every part of the toolbar: the pill, the inbox, an open thread and the toolbar's popovers and menus.
Point mode outlines the part and pins the comment without activating it; open popovers stay open
while they are pointed at and while a comment on them is written or read. Use Cancel in the
instruction or Escape to leave point mode. Keyboard reviewers can focus an inbox or toolbar control
before activating Add comment. A part in a popover or the inbox is saved with the button that opens
it (a thread's pin, Options, Inbox): while it is closed, the pin is beside that button, and showing
the comment opens it first. These anchors survive a reload, follow panel movement, and include the
reviewed UI in automatic screenshots. On third-party sites the toolbar stays excluded, and the review
API refuses toolbar anchors from them. Details: [docs/toolbar-review.md](docs/toolbar-review.md).

Configuration is read synchronously while the script runs (`src/config.ts`), from the script tag's data
attributes or from `window.uierConfig`, set before the script:

```html
<script>window.uierConfig = { mode: 'showcase', apiUrl: 'https://uier.io' };</script>
```

| Option | Script attribute | `window.uierConfig` | Default |
| --- | --- | --- | --- |
| Mode | `data-uier-mode` | `mode` (string) | `review` |
| API base URL | `data-uier-api-url` | `apiUrl` (string) | origin of the script URL |
| Project | `data-uier-project` | `project` (string) | none (comments per domain) |

`window.uierConfig` must be a plain object (including a null-prototype object) with own string
fields. Named elements, arrays, inherited fields, accessors and non-string values are ignored;
unreadable configuration falls back to the defaults. Script attributes take precedence. Repeated
scripts reuse the actual toolbar host under a window symbol; a page's own `id="uier-toolbar"`
does not prevent mounting.

The toolbar and inline thread shadow roots adopt one shared constructed stylesheet. They need no
`style-src 'unsafe-inline'` or style nonce. Keep the install guide's other CSP sources: uier's
origin for scripts/API/frames, `data:` images, and optional Google Fonts stylesheet/font origins.

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
guide; without it, comments can't load or post there (see above). `startUierComment()` takes the same options
and starts placing a comment instead, the toolbar's comment mode as its + button starts it (uier's app calls it
on C); like the + button's C, it comments on page text the toolbar holds selected. The package is part of this repository
and not published to npm yet.

### Review links

In `review` mode signed-in members can open the toolbar in the background. Review links remain available:

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
<script src="https://uier.io/toolbar.js" data-uier-project="V1StGXR8_Z5jdHi6B-myT" defer></script>
```

With a project the toolbar uses the review API, `<API base URL>/api/review/<project>`, instead of
`/api/comments`. The project's "who can comment" setting applies (`src/project/`):

- **Invited people**: a hidden `/review-session` frame first tries the existing uier login. It returns a
  project token only for a current member on a configured site. When unavailable, the pill says
  "Sign in to see and leave comments". Sign in opens the project's review
  link on uier (`/app/review/<project>?url=<this page>`), which signs the reviewer in and comes back with
  `?toolbar-code=<project>&uier-token=<single-use code>`. The toolbar exchanges the code for a review token
  right away and removes it from the address, saving the pending code in tab storage for up to ten
  minutes so a host authentication redirect cannot discard it before exchange. The token is kept in the site's `localStorage`
  (`uier:review-token:<project>`, 30 days) and sent as `Authorization: Bearer`.
- **Anyone with the link** (guests): anyone with a review link comments. The first comment asks for the
  guest's name (`uier:guest-name`); a random visitor id (`uier:visitor`, sent as `X-Uier-Visitor`) recognises
  their comments. No cookies are used: the API is on another site than the reviewed one.
- **Comments off**: the pill says "Comments are turned off for this project".

When the project cannot be loaded, the pill says "uier can't open this project here" and offers
**Copy note for the owner**. The plain-text note contains only this page's origin, the script's public
project code, a settings link on the API base URL and a request for an admin to check installation
and add the address under Site addresses if it belongs to the project. It includes no project
details, credentials, reviewer identity or page path/query/hash. Clipboard failure shows selectable
text; uier never sends the note. A denied origin cannot be distinguished from a missing project,
wrong API URL or outage, and no API/CORS disclosure is added.

An ended session offers **Sign in**, using the review link supplied by the API and returning to the
current page. Offline project loads ask the reviewer to check the connection and resume on reconnect.
These notices are never selected by a timeout. In `review` mode every notice also has **Exit review**
(an X button), so a reviewer who can't comment can still end the review. Comments off keeps only Exit review.

Members mark any comment done; the author and the project's admins delete it (the API returns
`permissions` and `canDelete`, and the thread shows only those actions). The profile shows the member's
account name or the guest's name; Sign out forgets the token, name and visitor id on this site and
disables background sign-in until an explicit authenticated review link. Exit review also prevents
automatic reopening in that tab. Background authentication uses a separate HttpOnly uier cookie and
silently gives up after three seconds if cookies or framing are blocked; it never opens a popup or
requests storage access. Comment APIs continue using headers and cookie-free browser verification.
`?uier-comment=<comment id>` (from "Copy link" in the app or a thread) opens that comment's thread. The API only
answers the project's own site addresses (CORS), so the script works only on those sites. Sites with a
Content-Security-Policy add the sources from the install guide's "Advanced" section, including uier's
origin in `frame-src`. Before a cross-origin write, an empty frame on the API's origin runs BotID and
returns a signed proof bound to the origin, project and reviewer. The toolbar caches it only in memory
for under five minutes and sends it as `X-Uier-Verification`. No third-party cookies are needed.

### Modes

- `review` mode mounts the toolbar only for a review (see above).
- `feedback` mode mounts it when the page asks for feedback or a comment: when the script loads, and again on
  every `uier:open-feedback` or `uier:start-comment` event on `window` after **Close toolbar** (in its options)
  removed it. It mounts with the feedback form open, or placing a comment (`uier:start-comment`, or
  `data-uier-open="comment"` on the script for its first mount); a toolbar already on the page does the same
  on the same events (`src/openFeedback.ts`).
- `showcase` mode (uier.io public pages) always mounts it. Review and showcase modes show the same
  first-run guide above the toolbar; About uier reopens it in every mode. Feedback mode opens and focuses
  its form without the guide covering it. Starting a comment or feedback remembers dismissal.
  Project dismissal uses `uier:hint:v1:<api URL>:<project code>` in the reviewed site's `localStorage`;
  without a project it keeps `uier:showcase-hint-dismissed`. Only `true` is stored, with no identity or
  credentials. Blocked storage leaves the guide usable and it may appear again next visit.
- The guide uses the current server review info for project access and the optional review brief.
  Only people who can comment receive the brief, like environments; sign-in and comments-off notices
  never show a guide or About uier. Public visibility/retention copy stays on public pages; app feedback
  privacy comes from `/api/visitor?path=...`, using the server's `isPrivateAppFeedback` rule.
- Admins write a plain-text review brief (up to 2000 characters) in project settings. It appears in the
  guide and behind Review brief in the inbox header, preserving line breaks. It never renders HTML,
  Markdown or links. Empty input clears it; changing a brief does not reset guide dismissal.
- The API base URL defaults to the origin of the toolbar script (`document.currentScript.src`), so a
  preview deployment's toolbar talks to that preview's API. When there is no script URL (e.g. loaded as a
  module script), the build-time `__UIER_API_URL__` is used (`https://uier.io`). The development build
  always uses `__UIER_API_URL__` (`http://localhost:4004`), because the toolbar dev server only serves the
  bundle.

### Decorative parts of a page

Mark an animation or a busy illustration with `data-uier-decorative`: automatic screenshots leave its
content out, because copying it makes every capture on the page slower. Screenshots do not copy heights,
so give it a `min-height` to keep its box the same size in them. uier.io's landing page marks its
how-it-works scene this way.

```html
<div data-uier-decorative aria-hidden="true" style="min-height: 380px">…</div>
```

### Modal dialogs, popovers and menus

Native modal dialogs (`dialog.showModal()`) can be reviewed while they are open. The page behind a
modal is inert, so while one is open the toolbar moves into it and shows above it: reviewers can pin
elements, draw areas and comment on selected text in the dialog. Pins show for the dialog's content
only, and leave when it closes. Escape first closes what the review has open (point mode, a composer,
a thread); Escape in the toolbar never closes the dialog, and Escape in the dialog itself works as the
page intends. When the dialog closes, the toolbar returns to `<body>` and the dialog restores the
page's focus as usual. Clicks on the toolbar do not reach the dialog, so a page that closes its dialog on
a click outside its box keeps it open.

The toolbar does the same for what pages close on a click, focus or key outside it: an open popover
(`popover` or `popover="auto"`), the popup of an expanded menu or select button (`aria-expanded="true"`
with `aria-haspopup` or a select-only `role="combobox"`, and `aria-controls` naming the popup) and a
script dialog (`aria-modal="true"`). Inside it, the toolbar counts as inside: reviewers can open the
menu, press the + button, pin an item and write the comment while the menu stays open, and its pins
show with it. The toolbar's keys, typing and clicks stay in the toolbar, so they never choose a menu
item; `aria-hidden` or `inert` that the page sets on the toolbar while the layer is open is taken
off. A click on the page outside the layer still closes it, and the toolbar returns to `<body>`.
A comment left in such a layer is saved with the element that opens it (`layer: { opener, label }`
on its position). While the layer is closed, its pin is beside that element and its thread says
"Open “Account” to see the comment in place."; open, the pin is on the commented item again. The app
and copied issues name it too ("Button, after opening “Account”").
Non-modal dialogs (`dialog.show()`), manual popovers, disclosures such as accordions and the
suggestions of a text field leave the toolbar where it is. While in a layer, the toolbar is its last
child: rules for the layer's last child (`:last-child`, Tailwind's `space-y-*`) apply to the item before.

## Comments API

`src/hooks/useComments.tsx` calls `<apiUrl>/api/comments` with `credentials: 'include'`; the API identifies
anonymous visitors with its HttpOnly `uier_visitor` cookie. Comments are public: every visitor sees the
unresolved comments of the page (`?path=` is `location.pathname` without a trailing slash) and can reply;
in a review the inbox also lists the site's other pages (`?scope=site`). Project settings can opt in to meaningful
query fields and `#/...` / `#!/...` routes. The shared `src/pageState.ts` contract filters reserved/credential and
tracking fields, bounds values and produces the same canonical page key in the browser and API. Older records keep
pathname identity; v1 view records never use the legacy query-prefix fallback. New comments also send `sourcePath`,
the same filtered page with its trailing slashes (`/plans/`), so Copy link and the inbox's Open on link return to
the address a slash-sensitive site serves; comments without one link to their key. Routing settings do not rewrite old
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
- Drag the **Move toolbar** handle with a mouse or touch to reposition the pill. Collapsed, the pill has no
  separate handle: drag the mark itself (a click still expands it).
  Arrow keys move it (Shift moves farther), Home resets it, and Options offers **Reset toolbar position** after
  a move. The centre is saved per site/browser in `localStorage` (`uier:toolbar-position:v1`), then clamped to
  the visible viewport on resize, orientation changes and on-screen keyboard changes. Controls remain
  horizontally scrollable on narrow screens. Dragging does not start from action buttons.
- The inbox uses the shared `DockablePanel` shell: 320px wide from 640px, 400px from 1280px. Drag the handle
  beside its heading toward either side, or use left/right arrow keys on it. The destination is shown before
  dropping; canceled drags keep the old side. The panel slides in from its side (it only fades with reduced
  motion). Each panel saves its own side (`uier:panel-side:v1:<id>`). Moving keeps content, filters and scroll
  state; narrow screens use a full-width inset panel and retain the preferred side for wider screens.
- **Mark all as read** appears beside Unread when listed threads include unread activity. It covers
  only the selected environment, pages, status, search, Unread and Assigned to me filters, including
  only listed threads when the site list is capped. Successful receipts refresh the badge and counts;
  failed writes retain their rendered cursors for Retry. A newer reply stays unread. The public and
  project APIs accept `POST comments/read` with `{ threads: [{ id, sequence }] }`, at most 200 entries
  and 48 KiB, returning `{ reads: [{ id, activity }] }` for successful acknowledgements only.
- **Profile** shows the visitor's guest name (`GET /api/visitor`). **Options** starts with the **Shortcuts** switch in its
  own group (on or off in place) and **Keyboard shortcuts** (the list, also on **?**; both shown where a
  keyboard is likely, `any-pointer: fine`, and always while they are off), then lists what applies: View project
  (a review of a project's site, or a review link with a project code), Exit review (`review` mode) and Sign out (`DELETE /api/visitor`, asks
  first: the comments stay, but this browser can no longer resolve or delete them). It always ends with
  **Powered by uier**, a link to uier.io in a new tab (the toolbar shows on other people's sites).
- Feedback and bug reports: the megaphone opens a dialog to choose feedback (heart) or a bug report (bug) and
  describe it. It is saved as a comment of that `kind` about the whole page (`position: { type: 'page' }`):
  no pin, but it is counted and listed in the inbox like any thread.
- Pins show the thread's number (`#12`, as in the thread, the inbox and the app), which replies never change.
  From the first reply, a small white badge on the pin's corner counts the messages; the pin's name says both
  ("Comment #12, 3 messages", with ", done" for a resolved thread kept open). Old comments without a number
  have an empty pin (the badge still counts replies), as do drafts and comments still sending.
- Point comments: the + button starts point mode (a pin beside the pointer and an instruction above the pill, Esc
  cancels). The element under the pointer gets a dashed accent outline, drawn by the toolbar over it (the
  page's own styles are not touched, and the toolbar's controls are never outlined); a click pins the comment. With the keyboard, focus an element on the page, Tab to the + button and press
  Enter: the comment is pinned to that element (Enter on a focused element in point mode does the same).
- Point mode does not cover the page. Presses on the page are taken before the page's own scripts see
  them, so nothing is activated, focused or selected, and what is open stays open: a menu that closes on a
  click outside it, a popover, a menu shown on hover. To comment on one, open it, then press the + button
  (or **C**; for a menu shown on hover, **C**, since the pointer stays on it) and point into it. See
  [Modal dialogs, popovers and menus](#modal-dialogs-popovers-and-menus). Frames, such as maps and
  videos, get a transparent shield while pointing: a click pins the frame and does not reach it.
- Keyboard shortcuts: **C** starts point mode and ends it again, like the + button with a pointer; with page text
  selected, it opens a comment on the selection. The + button shows it in its tooltip and `aria-keyshortcuts`.
  **G** then **I** opens the inbox, **/** its search, **J** and **K** go to the next and the previous thread (the
  inbox's cards while it is open, else the pins' threads in page order, with the focus on the messages), and in
  the thread with the focus (or the one open) **R** goes to the reply box, **S** to its status menu and
  **A** opens the people to assign. **?** lists them in Options. They do nothing with a modifier, while typing in
  a text field, in a widget whose letters choose an item (menus, lists, grids, comboboxes), in the toolbar's own
  dialogs (a thread's popover keeps the thread keys), while the toolbar is collapsed, or when the page handled the
  key itself (`preventDefault`). Single-letter shortcuts can be turned off (WCAG 2.1.4): Options turns them off in
  this browser (`uier:shortcuts-off` in `localStorage`, for the page only when storage is blocked; on uier.io the
  app's switch is the same one).
- The pill's buttons are one tab stop (`role="toolbar"`, beside the move handle): ← and → move between them, Home
  and End to the first and the last. The inbox's status tabs are one tab stop too, and the toolbar's popovers of
  buttons (Options, Thread options, a message's options, Copy) and the people to assign move with ↑ and ↓ like a
  menu. See [keyboard](docs/keyboard.md).
- Area comments: in point mode, drag with a mouse or pen to draw a rectangle over the part of the page
  the comment is about (a finger keeps scrolling the page; tap to pin instead). The area is saved on the
  innermost element that holds all of it, as a point (its top-left corner) with `widthNormal` and
  `heightNormal`, fractions of that element's box, so it follows the element when the page scrolls,
  resizes or reloads. The area has a dashed accent outline, tinted while its thread is open; its pin is
  at its bottom-right corner and the automatic screenshot shows the area. A drag shorter than 8 px on
  either side pins a point where it started. Toolbars without area support show the pin at the area's
  top-left corner.
- Rewrite suggestions: select text, then **Rewrite**. The form is laid out like a new comment's: the header
  (Omit screenshot, Expand), the quoted text, the instruction box, then the text box, which starts as the selected
  text, to edit into your version. **Suggest** (inside the instruction box; optionally with an instruction such as
  "shorter", Enter there asks too) requests AI suggestions from `POST /api/rewrite`, and picking one replaces the
  text as if it was typed (Ctrl/Cmd+Z brings yours back; a guest's name stays). Expand keeps the instruction and
  the suggestions. **Post suggestion** saves a comment with `kind: "rewrite"`, shown as "Suggested rewrite" with the
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
  it is searched for across the page, ignoring whitespace and excluding scripts and the review layer.
  Only a unique text match is restored. Threads explain exact/restored, hidden, missing and ambiguous
  anchors. Missing/ambiguous anchors have no fallback pin; every thread remains searchable in the inbox.
  Hidden targets (e.g. a closed `<details>` or a responsive layout) get no pin until shown.
- Reattach comment: the author or a workspace admin can choose a new element (pointer/touch or focus
  and Enter), a dragged area or selected text on the same reviewed page. Review the candidate and Confirm anchor, or
  Cancel/Escape to keep the saved anchor. Collapse cancels choosing and hides annotations. The shared
  dockable panel keeps the inbox side; toolbar movement stays available. A successful change keeps the
  thread, quotes, screenshot, author and status. Anchor details retain the original and immediately
  previous anchor, last change time and count; they follow the thread's visibility and retention.
  Revision checks reject stale choices; access/selector/page/project/origin checks run on the server.
  Cross-page migration and automatic AI relocation are not supported.
- Screenshots are captured automatically when a new element/text comment, rewrite, feedback or bug report starts.
  There is no camera button or preview while writing. The form's header has a screen icon, **Omit screenshot**: its
  tooltip says that a screenshot will be attached (or that it is being taken, or could not be taken), and pressing it
  (a crossed-out screen) posts only the text: no image is sent for that comment. **Attach image** beside it, or
  pasting an image into the form, sends the reviewer's own PNG, JPEG or WebP (up to 512 KB and 4096 pixels on each
  side) instead of the screenshot; the header names the file and removes it again. Posting waits for that capture attempt (up to 15 seconds);
  a failed capture still saves the text. Reopening or restoring a draft refreshes its capture and viewport from the current page, and
  discarding it saves no image. Replies and edits keep the original screenshot. Saved threads and the inbox
  show a small thumbnail; click, tap or press Enter to expand it, and close to return focus to the thumbnail.
  Capture excludes the toolbar and inline review threads; DOM/CORS limitations remain in
  [Screenshots](../../docs/review-workflow.md#screenshots).
- Every comment saves the device size, viewport, pixel ratio, browser and OS when feedback starts (`getDeviceInfo`):
  names parsed in the browser from Chromium's client hints or the user-agent string (`describeDevice` in
  `src/userAgent.ts`; the string itself is never sent), a phone's model when the browser reports it, the primary
  input, colour scheme, reduced motion and the page's language.
  A thread shows it as two icons after the first message's time, like the app's comment cards: the screen size
  (desktop, tablet or phone; none when it was not recorded) and, for authorized project members, the browser's own
  mark (a globe when it is not recognised). The details show the browser and the operating system with their marks.
  Hovering shows the details without moving focus; a click keeps them open, Enter opens them with the focus
  inside, and Escape returns it to the icons. Everyone sees the screen size and viewport ("1280×720 CSS px"); members also see
  the pixel ratio, browser/version, OS, original capture time and a safe page link, with **Copy reproduction
  details** for the same fields as text. Guests and public viewers never get the browser, OS, capture time or
  copy. Unsupported/older fields stay Unknown or Unavailable. Links include only stored, approved page state;
  tracking, credential and review-token fields are excluded. Resizing, replying and editing do not replace the original context.
- The text box grows with the text; Enter posts, Shift+Enter adds a new line. No line under the text box says so:
  the keyboard shortcuts list in Options (`?`) has both keys, as the app's has. Where a mouse or trackpad is present
  (`any-pointer: fine`) the text box is described to screen readers as "Enter to send. Shift+Enter for a new line."
  (save for edits); a phone's on-screen Enter key sends and has no Shift, so there the textarea's `enterkeyhint`
  labels that key Send (Done for edits) instead.
  Unsent text is kept when the popover closes (a new comment stays as a draft pin until it is posted or discarded).
  A composer that opens with such kept text says "Draft saved in this browser" under its box (only from the start,
  so nothing appears or moves while typing; not while sending, after an error, or when storage is unavailable).
  While a new comment or rewrite draft pin is closed, **Resume draft** appears above the pill: it scrolls the pin
  into view when needed and opens its composer with the text (the latest draft when there are two).
  Comments, replies and feedback are sent in the background: the form empties at once and the comment or reply
  shows straight away (a pending pin reads "Comment, sending" and counts only saved messages; its thread opens
  once it is saved, and replies to it wait for its id). The text stays with the draft until the send settles, so
  leaving or reloading the page meanwhile keeps it. A failure removes the comment or reply, puts the text back in
  the draft (a new comment's draft pin returns with the reason) and says so in a toast. Edits still wait for the save.
  Seven-day browser-local text/anchor drafts are scoped to the API, project, authorized reviewer, canonical page and item. Reload/navigation restores the draft; Discard, successful posting and toolbar sign-out clear it. Images are never stored with drafts. Blocked/full storage falls back to memory with a notice. See [Draft recovery and submission retries](../../docs/review-workflow.md#draft-recovery-and-submission-retries) for expiry and idempotent create/reply behavior.
- After posting, the new comment's thread opens with the focus in its reply box, and "Comment posted" /
  "Reply posted" is announced. Escape closes the thread and the focus goes to its pin.
- A thread starts with its status, public id (`#12`, numbered per site) and a blue dot while it is unread
  (clicking it marks the thread read), then icon actions (named by their tooltips). The status is a menu, as in
  the app (**Open**, **In progress**, **Ready to verify**, **Done**), for the comment's author (in a project, its
  members); everyone else sees it as a badge. Then **Copy issue** and **Copy link** for everyone, and **Thread options**
  with **Mark as unread** once a thread with someone else's activity is read. The link is the comment's page with `?uier-comment=<id>` (plus the review
  link in a review, so the toolbar opens for whoever follows it); opening it opens the thread on its pin, or
  the inbox for a done thread or feedback. The parameter is then removed from the address. Done threads have
  no pin; the inbox lists them under "Done".
- The inbox (the pill's inbox button opens and closes it; Esc and the close button close it too) starts with
  the search box, which matches messages, quoted text, guest names, page paths and public ids whatever else is
  chosen. Under it, the location picker (like the app's: a project's environments on the left, pages on the right,
  with a page search) lists **This page** (the default), **All pages**, sections such as `/blog/…` (or any path typed
  with a leading `/`) and each of the site's other pages (`?scope=site`) with their matching comments, next to the **Unread** and **Assigned to me** filters
  (Unread shows every page and status, like the pill's count). **Open**, **Done** and **All** sit right above the
  list, newest first; with nothing on this page, the list offers the other pages' matches. A thread shows its first and last message; **Show all** shows the rest.
  **Show on page** (only while the comment's pin can be placed) opens an open comment's thread on its pin; a
  comment on another page links to its thread there (`?uier-comment=`, always on this site). The pages, status
  and search are kept while the inbox is closed; Escape clears a search first. The showcase includes other public pages too.


### Review freshness

Expanded, visible, online reviews refresh every 15 seconds while active, every 30 seconds after
one minute without review interaction and every 60 seconds after two minutes. Interacting with an
idle review refreshes immediately. Focus, visibility return, reconnect and expansion also refresh
immediately; changed responses restore the fast cadence. Hidden, offline and collapsed reviews do
not poll. Refreshes preserve drafts, focus, open threads and unread state, and still recheck access.
See the [full freshness contract and request measurements](../../docs/review-workflow.md#polling-request-measurement).


### Assignment and mentions

Signed-in project members can change a thread's assignee in its toolbar details or inbox.
The assignee shows in the thread's header as their avatar (the user icon while unassigned),
with a tooltip that names them. The app and toolbar use the same assignment service. Assigned
to me combines with page, status and search filters. Guests see the assignee's avatar and name
but cannot change assignment or look up the participant directory. Removed members appear as Former member (no access);
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

- `src/runtime.tsx` mounts the toolbar into an open shadow root on `<div id="uier-toolbar">` (open so
  assistive technologies, accessibility checks and end-to-end tests can reach it; the page's own scripts
  and styles can't change it by accident either way). Everything, popovers included, renders inside it and
  the toolbar adds no styles to the page (`apps/web/e2e/embed.spec.ts` checks a reviewed site's computed styles).
  While a native modal dialog is open, `src/modalLayer.ts` moves the host into it as a manual popover
  (top layer, above the modal; `:host([popover])` in `src/styles/toolbar-theme.css` gives it no box of its own).
- Styles are compiled with Tailwind CSS v4 (`src/index.css`, `postcss.config.mjs`) and inlined into
  `dist/review.js` at build time (see `tsup.config.ts`, placeholder `__uier_toolbar_css__`). The complete
  JavaScript literal is JSON-encoded and parsed before publication. Every review shadow root adopts
  the same constructed sheet; unused `@property` registrations are omitted and fallback values retained.
- Colors come from `@uier/brand/tokens.css`. The pill, the pins and the inbox sidebar are always ink
  (`src/components/InkScope.tsx`); thread popovers and the hint follow the system light/dark theme.
  `src/styles/toolbar-theme.css` keeps the page's inherited text styles out and honours reduced motion.
- UI components come from the `@signalco/*` UI kit; `src/styles/tailwind-v3-compat.css` keeps the kit's
  Tailwind v3 class names rendering as they did with Tailwind v3.
- The embedded bundle maps the kit's `next/link` to a ref-forwarding native anchor. All toolbar
  links use browser navigation on the reviewed site, keeping the framework router out of the
  toolbar bundle; the React script-loader entry stays unchanged.

## Scripts

- `pnpm build` - loader in `dist/index.js`, review UI in `dist/review.js` (CSS included), the Accessibility panel's axe-core in `dist/audit.js` (loaded by the review UI only when the panel runs a check), loader path/SRI in `dist/bundle.json`, and the React component in `dist/react.js`
- `pnpm dev` - rebuild on change into `dist-dev` and serve it on http://localhost:4005 (loaded by `apps/web` in development, which imports the modules from `dist-dev` through the `development` export condition); with `PORT` set, on `PORT + 1`, calling the web app on `PORT`. Production builds keep `dist`, so typecheck, build and tests can run beside it
- `pnpm typecheck` - type check with `tsc`
