# packages/toolbar - agent guide

The review toolbar: a small classic-script loader (`dist/index.js`) that a site includes. It loads
the separate review IIFE (`dist/review.js`, with CSS inlined) and mounts the comments UI into an
open shadow root when the page is opened with
a review link (`?toolbar-code=<project code>` or `?review=true`) or a project member signs in silently
(`review` mode; the review then lasts
for the tab, `src/review.ts`), always (`showcase` mode, every public uier.io page) or when the page asks
for feedback (`feedback` mode, the uier app's "Give feedback" button, `src/openFeedback.ts`). The link only
starts the review: the project whose comments apply is the script's `data-uier-project`
(`src/config.ts`). Configuration and bridge validation accept 21-character public Nano IDs and
legacy random 12-character codes; do not trim their alphabet to lowercase. `dist/react.js` is the React component that adds the script
(`@uier/toolbar/react`, `src/react.ts`, with a `project` prop), plus `openUierFeedback()`. Embedding and configuration:
[README.md](README.md).

## How it is built

- Browser builds resolve the latest two stable major releases of Chrome, Edge, Firefox, Safari and
  iOS Safari from the root `.browserslistrc`, shared with Next.js. `browserslist` is build-only;
  tsup maps its versions to esbuild targets. Pure browser/server exports retain ES2022 for Node 26.
  Do not add runtime polyfills or old-browser branches. Keep blocked-storage/CSP handling, shadow-root
  property initialization and the UI kit's Tailwind v3 class mapping: modern browsers still need them.
- `src/index.ts` captures configuration and review state, runs installation diagnostics and the bounded
  background member check, and loads the content-addressed, integrity-checked review script only when
  needed. Concurrent embeds share the download; failures allow a later request to retry. `runtimeContext.ts`
  passes the captured configuration, in-memory identity and diagnostics through a symbol on the script
  element, including when browser storage is blocked. Preserve the loader nonce and script origin.
- `src/runtime.tsx` creates `<div id="uier-toolbar">`, attaches an open shadow root (so assistive
  technologies, axe and Playwright can reach it), adopts the shared constructed stylesheet from
  `stylesheet.ts` (tsup replaces `__uier_toolbar_css__` with `dist/review.css`) and renders
  `CommentsBootstrapper` into a `<div data-uier-root>` inside it. `mount.ts` tracks the actual host
  with a window symbol, including helpers that cross its shadow boundary; never use an id as the
  duplicate-mount guard. Clear only this instance's marker on exit.
- `modalLayer.ts` (`followPageLayers`) keeps the host in the page's topmost open layer: a native modal
  dialog (`:modal`, watched through the `open` attribute), an auto popover (`toggle` events; it
  leaves on `beforetoggle`, since a hidden ancestor hides the host; not `hint` tooltips), the popup that an
  `[aria-expanded="true"]` trigger with `aria-haspopup` (or a select-only `role="combobox"`) names in
  `aria-controls`, or an `[aria-modal="true"]` element. The host is the layer's last child and a manual popover
  shown after it, so it is in the layer's subtree and in the top layer above it. For a modal that is what
  keeps it usable (not inert; a top-layer popover outside the modal stays inert, and no z-index helps);
  for the others it is what makes the page count the toolbar's presses and focus as inside (`contains`,
  `composedPath()`, React's component tree, native light dismiss, focus traps). While in a layer the host
  keeps its keys, input and clicks from the page (and takes `aria-hidden`/`inert` off itself): register
  window `keydown` listeners with `listenToWindowKeydown`, which also gets the kept ones, and stop
  path walks at the host (`isLetterKeyTarget`). Moving the host gives the toolbar's focus back; the followed layer and its ancestors are watched for
  `class`/`style`/`hidden`, so a layer hidden by its classes does not hide the toolbar.
  `:host([popover])` gives the host no box and no transform:
  Lightning CSS merges `translate`/`scale`/`rotate: none` into a transform that is not `none`, which
  would hold every fixed box, so keep only `transform: none`. `[data-uier-root]` sets `pointer-events: auto`
  against a modal menu's `body { pointer-events: none }`. Point mode, areas, the keyboard path and pins use
  `isInActiveModal` (the inert page behind a native modal has no pins or anchors). Escape inside the host does not
  reach the layer; the dialog restores focus itself on close. Non-modal dialogs, manual popovers,
  disclosures and text-field suggestions are unchanged.
- Styles: Tailwind v4 (`src/index.css`) with the signalco minimal theme preset and
  **`@uier/brand/tokens.css`**. The tokens use `:root, :host`, so they apply inside the shadow
  root (`:root` alone would not). The `[data-uier-root]` container gets the `dark` class when the
  system prefers dark, so threads follow the system theme; the pill and the sidebar are wrapped in
  `components/InkScope.tsx` (always the dark tokens), pins are always ink.
- Fonts: `runtime.tsx` appends the self-hosted Geist stylesheet (`GEIST_FONTS_PATH` from
  `@uier/brand`, resolved against `toolbarConfig.apiUrl`) to the host document, because `@font-face` inside a shadow root is unreliable.
  If the host's CSP blocks it, the toolbar falls back to `system-ui`.
- The comments API base URL comes from `src/config.ts`: the script tag or `window.uierConfig`,
  else the toolbar script's origin, else the build-time `__UIER_API_URL__` (`tsup.config.ts`; the
  dev build always uses http://localhost:4004). Accept only plain window configuration with own
  string-valued data properties; ignore named elements, accessors, non-strings and read failures.
- The final CSS-inlined review bytes produce a SHA-256 path and SHA-384 SRI embedded in the loader.
  The loader bytes produce `dist/bundle.json` (`@uier/toolbar/bundle`): its SHA-256 path and SHA-384 SRI.
  The web build publishes default/pinned loaders and the review asset, retaining both in its archive. Keep
  production pins/API compatibility for one year after last release as current (docs/api.md).
- UI-kit `next/link` imports in the embedded IIFE resolve to `components/ToolbarLink.tsx`, a
  ref-forwarding native anchor: reviewed sites need browser navigation, not Next.js routing.
  `process.env` remains stubbed to `{}` for browser compatibility of dependencies.
- "Exit review" unmounts the React root and removes `#uier-toolbar` (`runtime.tsx`). It is in the
  options and, when a project's reviewer can't comment, on the notice pill (`project/ProjectGate.tsx`).

## Components

| File | What |
| --- | --- |
| `components/CommentsGlobal.tsx` | top level: pins (in page order), point mode and its keyboard path, selection handling, focus after posting, the first-run hint; collapsing hides the on-page review layer and cancels placement/selection controls, keeping draft text and inbox state |
| `components/CommentToolbar.tsx` | the black pill (`nav` landmark): add comment, inbox with the blue unread count, about, profile, options, collapse/expand; the point-mode instruction (`role="status"`) and, in its place while a draft pin is closed, **Resume draft** (outside the pill, so its width never changes) |
| `src/shortcuts.ts` | the keyboard shortcut: C starts or ends point mode, or comments on a page text selection (`CommentsGlobal`, a bubble-phase window listener, so a page that handles the key with `preventDefault` keeps it). Ignored with modifiers, key repeat and composition, in text fields and letter-key widgets (`isLetterKeyTarget`, across shadow roots), in the toolbar's dialogs, while reattaching and while collapsed. Add comment names it in its tooltip (mono `kbd`, `IconTooltip`'s `shortcut`) and `aria-keyshortcuts`, as does the selection toolbar's Add comment. Options turns it off per browser (WCAG 2.1.4; `uier:shortcuts-off`, boolean only) |
| `components/ToolbarProfile.tsx`, `ToolbarOptions.tsx` | the profile (guest or account name; signed in, its button shows the account's initial like the app's avatar) and the options (the C shortcut's switch where a keyboard is likely, reset moved toolbar, view project, exit review, sign out) popovers; on uier's own pages, account sign-out stays in the app's account menu. Options always ends with "Powered by uier", a link to uier.io (the toolbar runs on other people's sites) |
| `components/ToolbarFeedback.tsx`, `CommentKindLabel.tsx` | the feedback dialog (feedback or bug report about the page, no pin) and the "Feedback" / "Bug report" label of such threads |
| `components/InlineCommentThread.tsx` | live `data-uier-thread="<comment id>"` slots: same thread and reply composer as the pins, adopting the same constructed sheet in their shadow root, with cleanup; never auto-focus on load |
| `components/CommentBubble.tsx`, `CommentThread*.tsx` | a pin (`<Pin />` from `@uier/brand`: the issue number inside, the message count as its corner badge from the first reply, the name "Comment #6, 3 messages") with its thread popover (bounded by the window, clear of the pill) and reply form; one thread layout for popover and inbox, so an opened thread shows its messages and reply box first: `CommentThreadHeader.tsx` is one line (status, `#id`, the blue unread dot that marks the thread read, a priority other than Normal, the assignee's avatar from `CommentAssignment.tsx` with the AI agent working under them stacked on it (`agents.ts` marks), named by its tooltip ("Assigned to you, with Claude"); then Mark as done / Reopen for those who can resolve, Copy, a menu with Copy issue and Copy link `?uier-comment=` (`src/review.ts`), each described, and Thread options, `CommentThreadMenu.tsx`, with the triage and email controls each person may use: assign (the people open under the line), priority, Mark as in progress / Mark as open (for those who can resolve, on an Open or In progress thread; `PATCH` with `{ status }`), Request verification, Follow / Unfollow thread, Mute project emails and, once read, Mark as unread; no menu when there is none). The source line shows in the inbox, and on the page only when the original source is unavailable; messages have an avatar column and no dividers. Icon buttons show their names with `IconTooltip` / `useIconTooltip` (hover after 300 ms, at once on keyboard focus; portaled into the shadow root's container with a fixed position, decorative, never on touch): use it instead of `title` for icon-only controls. `CommentScreenshot` keeps the thumbnail alone: Upload image and Paste image are in its expanded view beside Redact screenshot (or beside "No screenshot"). The app's `CommentCard` follows the same layout, icons and words: change both together |
| `components/CommentPointOverlay.tsx` | point mode, without a cover over the page: presses that point at the page (`pointsAtPage`: outside the host; pins, highlights and frame shields; on uier's own pages the reviewable surfaces) are taken on the window in the capture phase, before any page listener, and cancelled (focus, selection, drags, links, controls; touch is not cancelled, so it scrolls). Menus, popovers and dialogs that close on a press outside stay open, and moves still reach the page, so hover menus stay open too. Frames get transparent shields (`data-uier-shield`), since their presses go to their own document. It draws the outline of the element under the pointer and an add-comment pin beside a mouse or pen pointer (`data-uier-pointer`; the page keeps its cursor). The element is the topmost one whose own box holds the pointer, so a stretched link (`::after` over a row or card) does not hide the row's picture, summary or badges. A mouse or pen drag draws an area instead (`data-uier-drawing`), also when it ends over the toolbar: saved on the innermost element that holds it, as a point at its top-left corner with `widthNormal`/`heightNormal` (`isCommentArea`), so older toolbars still pin it; the click that ends a drag is ignored |
| `components/CommentAreaHighlight.tsx` | the dashed accent outline of a commented area (`data-uier-area`), with the selection tint while its thread is open; it never takes clicks (the pin opens the thread). Areas resolve to their rectangle in `useCommentItemRects`, so the pin sits at the bottom-right corner and the screenshot is the area |
| `components/CommentComposer.tsx` | the comment/reply text box (auto-growing textarea: Enter sends, Shift+Enter new line, `enterKeyHint`) in one bordered box with its hint or counter and the send button, keeps drafts |
| `components/ComposerFooter.tsx` | the line under every composer: "Shift+Enter for a new line" (the app's wording; only with `any-pointer: fine`) and "Draft saved in this browser" for a composer that opened with kept text. It describes the text box; keep it free of claims beyond browser-local storage |
| `components/CommentThreadItemMenu.tsx` | item options (edit with Save/Cancel and stale-edit protection; Reattach comment on the first message; delete with a confirmation); `CommentThreadItem.tsx` renders an inline `CommentComposer`, keeps failed text and returns focus to the menu |
| `components/CommentErrorBoundary.tsx` | wraps every pin, highlight and sidebar thread: a comment that fails renders nothing |
| `components/CommentsErrorMessage.tsx` | friendly messages for API errors (`rate_limited` with `reason: "too_fast" \| "page_full"`, ...) |
| `components/Announcer.tsx` | the polite live region ("Comment posted", "Reply posted", "Comment deleted", "Reply deleted") |
| `components/ProjectNotice.tsx` | shared ink notice pill: one next step and Exit review, wrapping at narrow widths; button links retain coarse-pointer hit areas |
| `components/ShowcaseHint.tsx` | first-run hint and About uier: on uier.io's landing page only (showcase without a project, `showAbout` in `CommentsGlobal`), not on its other pages, in the app, in reviews or in embeds |
| `components/CommentIcon.tsx` | the outlined pin icon (Add comment), from `PIN_PATH` in `@uier/brand`; pins on the page are `<Pin />` from `@uier/brand` |
| `components/CommentSelectionHighlight.tsx` | the tint over a commented text range (`--brand-selection`), clickable for saved comments |
| `components/CommentSelectionPopover.tsx`, `RewriteIcon.tsx` | the toolbar for selected text (`role="toolbar"`, "Selected text"): Add comment, Rewrite; ink and the pill's height (36 px buttons), the add-comment pin and the custom rewrite icon (text lines and a pencil) |
| `components/RewriteSuggestions.tsx`, `hooks/useRewriteSuggestions.tsx` | AI suggestions under a rewrite's text box (`POST /api/rewrite`) |
| `components/info/`, `hooks/useHoverPopover.ts` | `getDeviceInfo` (read when feedback/capture starts) and `CommentDevice`, the app's `CommentDevice` in the toolbar: after the first message's time, a desktop/tablet/mobile icon (only when the size is known) and a browser globe (only with the API's member-only `reproduction` field). Their popover opens on hover without moving focus, stays open after a click, and Enter moves focus in (Escape returns it, without closing the thread or inbox); it lists the screen (size, viewport, pixel ratio), browser and OS, capture time, the Reviewed page link and Copy reproduction details. Guests and public viewers get the screen row only. `useHoverPopover` focuses the first button itself: Radix's first focus fails in a shadow root |
| `src/screenshot.ts`, `components/CommentScreenshot.tsx`, `components/ScreenshotDisclosure.tsx` | automatic screenshots: the region of a new comment, drawn from the page without the toolbar (`modern-screenshot`, the scroll as a negative margin so fixed elements stay, fonts inlined, the content of `data-uier-decorative` elements left out: they keep their `min-height`), encoded under the API's limits; capture starts from the feedback event (the window, its scroll and inner scroll are read then), but copies the page only after the composer's first frame, in about 8 ms pieces that yield to the page (`scheduler.yield`, else a message), leaving out blocks more than a window's size from the window (all of a block below it in a block's flow, else its content: the copy keeps every element's `width`/`height`; sticky elements and shadow roots are always kept), and encodes with `toBlob` (#319); restored/reopened drafts refresh it without persisting images, and saved thumbnails expand in a shadow-root popover. New comment and feedback composers render `ScreenshotDisclosure` beside (not inside) `CommentComposer`: the capture status in words and a per-comment **Omit screenshot** toggle that leaves `screenshot` out of the request; never an image |
| `src/screenshotPolicy.ts`, `src/suppliedScreenshot.ts`, `components/ScreenshotRedaction.tsx`, `hooks/useReplaceScreenshot.ts` | saved evidence upload/paste and opaque rectangle redaction, using shared API limits; replacements invalidate cached originals and update all comment lists. Redaction opens only from expanded saved details; composers never preview images |
| `components/sidebar/` | the inbox sidebar (ink, radius 16): the search on top, then `LocationPicker` (the app's two-column location filter in the UI kit's `Popper`: a project's environments on the left, then pages with a search: this page by default, all pages, sections (`section:/blog`, also from a typed path) or one other page, each with its matching count) with the Unread and Assigned to me filters (outlined toggles like the app's Unread; the search and filters sit closer together than the title and tabs), then the Open/In progress/Ready to verify/Done/All tabs counted for the chosen pages (Open is everything not done), then the list (`useInboxComments.ts`, `CommentsFilter.tsx`). Cards end with Show on page (this page) or a link to their page; an empty "this page" offers the other pages' matches; Unread lists all pages. The list renders its first 20 threads with the panel and the rest in a deferred render, so a long inbox opens without a long task |
| `hooks/useComments.tsx`, `hooks/useVisitor.tsx` | React Query hooks against the comments and visitor APIs (`hooks/api.ts`: requests, errors, query keys); with a project, the project's review API. A change to a comment updates every cached list that has it (the page's and the site's) |
| `project/ProjectGate.tsx`, `project/projectSession.ts` | project mode (`data-uier-project`): who the reviewer is and what the project allows (comments, or a notice with Exit review: sign in, comments off), the review token, guest name and visitor id in the reviewed site's `localStorage` |
| `project/verification.ts` | cross-origin writes get a BotID proof through the API's `/review-verification` frame (no cookies); checks message origin and source, caches the proof in memory for under five minutes, fails closed |
| `project/backgroundSession.ts` | silent member sign-in through `/review-session`; exact frame/origin/nonce checks, one three-second attempt per page, no popups or storage-access prompts. Sign-out opt-out and tab Exit review take precedence; only authorized members auto-open without a link |
| `project/installationCheck.ts` | explicit `uier-check` nonce flow: public configuration/status reports to the install page, bounded lifetime, browser CSP evidence, read API and verification proof; never posts a test comment or sends tokens in a diagnostic report |
| `pageState.ts`, `hooks/usePagePath.tsx` | shared browser/server canonical identity (pathname by default; approved query fields and optional hash routes), `sourcePagePath`/`storedSourcePath` (the same filtering with trailing slashes kept, for links only, never a key), the names of other selectable query fields sent with new project comments for the settings suggestions (`pageQueryKeys`), SPA history/hash subscriptions with cleanup and a fallback; exported as `@uier/toolbar/page-state` |
| `hooks/useCommentItemRects.tsx` | resolves positions to rectangles and pin placements; offsets are verified, then a lazy whitespace-free page index is shared by every comment, with one record per text node. Exact/restored/missing/ambiguous results persist until the DOM version changes; geometry/visibility is remeasured on layout frames. No pin for missing/ambiguous/hidden anchors; never throws |
| `hooks/useLayoutVersion.ts` | shared geometry version for scroll (capture), resize, size and DOM changes; separate DOM evidence version for anchor/index invalidation, including observer restarts |
| `hooks/useReviewMovement.ts`, `components/DockablePanel.tsx` | shared pointer/touch handles, visible viewport bounds, toolbar position and reusable panel docking; versioned browser-local preferences and keyboard alternatives |
| `hooks/useDrafts.tsx` | seven-day browser-local text/anchor/edit snapshots scoped to API/project/authorized reviewer/canonical page/item; `draftStorage.ts` handles expiry, discard, sign-out clearing, blocked storage and stable submission identities; captures stay in memory and refresh on reopen |

The inbox's Reply action mounts `CommentComposer` only for the opened card, inside a
`DraftsProvider` for the target thread's canonical saved page. It reuses `useComments().reply`,
sharing drafts, submission keys and pending locks with the pin on that origin. Cross-page,
foreign-environment and unavailable-source threads remain answerable. Previews/composing stay
unread; replies preserve Open/Done. Reply response handlers use reviewer revisions so sign-out
cannot repopulate another reviewer's caches. The pure `@uier/toolbar/drafts` subpath exports draft
storage without runtime, React providers, fonts or styles; the app uses it independently.
Failed sends retain newer text, and overflowing earlier text is recoverable through Restore unsent
text. Drafts are local to each browser origin and expire after seven days.

## Rules

- Pending review codes are saved before URL removal in API/project-scoped session storage for ten
  minutes, to survive host SSO redirects. Clear on successful exchange, definitive rejection or sign-out.
  Background authentication may use its dedicated cookie; comment and verification APIs still use headers.

- The review layer is always ink: the pill and the sidebar render inside `InkScope` (dark tokens)
  and pins are ink, whatever the host page looks like. Thread popovers and the hint use the theme
  tokens (`bg-popover`, `text-foreground`) so they follow light/dark. Blue (`--brand-accent`) only
  for the focus ring, the selection tint, the unread count and links. See
  `packages/brand/BRAND.md`, "The review layer".
- Stored comments come from anonymous visitors: resolve positions only through
  `hooks/useCommentItemRects.tsx` (`safeQuerySelector`, clamped offsets) and keep every comment
  inside a `CommentErrorBoundary`, so one bad comment can never take the toolbar down.
- `toolbarReview.ts` permits targeting the toolbar/inbox only when the page and configured API
  share an origin. Stored `#uier-toolbar>>>` anchors cross only that shadow boundary; the API
  validates the inner selector with the existing restricted grammar. Keep stable surface ids,
  ignore annotation mutations in layout tracking, and include the reviewed surfaces (without
  pins, overlays or placement instructions) in screenshots only for these anchors. Text selection
  inside review UI remains excluded so reading and composing feedback does not start new drafts.
  `e2e/toolbar-review.spec.ts` covers targeting, persistence, screenshots, movement and keyboard
  access; `e2e/embed.spec.ts` checks third-party controls stay excluded.
- Everything rendered must work inside a shadow root on an unknown page: no global CSS, no
  assumptions about the host's fonts or variables, no `document.body` styling.
- Cross-site embeds require `data-uier-project`. The project's addresses decide CORS; the install
  guide includes the API origin in `frame-src`. Missing cross-origin configuration shows an install
  guide link before `useVisitor` or comments hooks mount; same-origin showcase/feedback is unchanged.
  Failed comment loads of configured projects show a message and retry action. Offline gate loads
  show connection guidance and recover through `refetchOnReconnect`, never a timeout-based notice.
- Gate failures offer a copyable owner note made only from `location.origin`, the script's public
  project code and the API base URL's settings link. Never use fetched project details, reviewer
  identity, tokens or page path/query/hash in it; keep the manual clipboard fallback and announcement.
  Ended sessions carry the fetched `signInUrl` and page-state policy on their error. Both sign-in
  notices send only `location.origin` plus `pagePath` with that policy, never the raw page URL.
- UI comes from `@signalco/ui-primitives` / `@signalco/ui`; icons from `@signalco/ui-icons`
  (Lucide, 1.75 stroke). Do not add Next.js-only imports; this runs in any page.
- Keep the loader below 7.5 KB raw / 3.1 KB gzip (`e2e/toolbar-assets.api.spec.ts`). React, styles,
  fonts and screenshots belong to the review bundle and must not load for ordinary visitors.
  Background member checks need only Authorization; keep guest-id generation out of the loader.
  `e2e/toolbar-bootstrap.spec.ts` covers deferred loading, configuration/identity handoff, concurrent
  requests, nonce/SRI, failure retries and feedback reopening. Keep the review bundle small: no new large dependencies without a reason (`modern-screenshot`, about
  25 KB, draws screenshots; there is no lighter way that keeps the page's own CSS).
- Capture starts automatically for new feedback, and composers say so; Omit screenshot sends that one comment as text only,
  stops a capture still being taken (`cancelCommentScreenshot`; turning it off again takes a new one)
  (`CommentDraft.omitScreenshot` carries the choice through a failed send, in memory only). Image selection and redaction happen after saving,
  outside draft/idempotency storage. Saved thumbnails expand by click, tap or keyboard; failed image
  replacement retains feedback and reports the error. Keep the API's revision check on replacements.
  `apiImage` negotiates short-lived private Blob URLs and fetches bytes without cookies, review
  headers or referrers. Never forward uier headers by redirect. The embed CSP needs the configured
  Blob origin in connect-src; rendered images still use memory-only data URLs.
- Coarse pointers get a 44 px minimum button hit area from `styles/toolbar-theme.css`, including
  compact UI-kit movement and thread controls. Preserve this when changing toolbar/panel layouts.

## Working on it

- `src/realtime.ts` is the small shared browser subscription client (`@uier/toolbar/realtime`).
  `useCommentsRefresh` owns one socket per expanded review; events reuse its coalesced authorized
  refresh. Keep the adaptive polling fallback, 60-second connected safety read, origin-bound ticket
  in the first frame, visibility/offline cleanup and reconnect backoff. Packaged extensions retain
  their HTTP broker path. See [realtime](../../docs/api.md#realtime-comment-changes).

- Project threads expose member follow/unfollow and project mute in Thread options
  (`useThreadNotificationActions`), and `ThreadNotifications`: the optional guest **Email me replies** flow after posting. Email is never a comment requirement.
  Subscription writes use the review API's existing identity, CORS and verification checks; guest
  addresses are verified by an explicit button on uier.io. Do not store addresses in browser storage.

- `pnpm dev` at the repository root rebuilds on change into `dist-dev/` and serves it on
  http://localhost:4005 (the port after `PORT`, whose web app API the dev build calls); the web app
  loads it in development, and `next dev` imports the toolbar modules from `dist-dev/` through the
  `development` export condition. Production builds write `dist/` only, so `pnpm typecheck`, `build`
  and `test` never replace the running dev toolbar. Give every new `dist/` export a `dist-dev/`
  `development` entry too. Open
  http://localhost:4004/?review=true (or any page, e.g. `/brand?review=true`).
- `pnpm -C packages/toolbar build` produces the production bundle; `pnpm typecheck` checks it.
- End-to-end tests run the built toolbar on the landing page: `apps/web/e2e/showcase.spec.ts`
  (desktop and mobile, with axe checks), and on a reviewed site on another origin:
  `apps/web/e2e/embed.spec.ts`; review links and the pill's controls are in
  `apps/web/e2e/review.spec.ts`; the inbox is in `apps/web/e2e/inbox.spec.ts`; a project's site (the
  script tag, the React component, the notices and their Exit review) is in
  `apps/web/e2e/project-review.spec.ts`; pins and highlights after a reload, a scroll and a resize
  are in `apps/web/e2e/anchors.spec.ts`; composer keyboard hints, the saved-draft cue and Resume draft are in
  `apps/web/e2e/composer-hints.spec.ts` (desktop and mobile); the C shortcut and its switch are in
  `apps/web/e2e/shortcuts.spec.ts` (desktop); Add comment after or over an open thread
starting its own pin (never a reply) is in `apps/web/e2e/new-comment-after-thread.spec.ts`, and a member's
toolbar comment matching the app (pin number, avatar, follow state, no-reviewer request form) in
`apps/web/e2e/toolbar-app-parity.spec.ts`; native modal dialogs (the reviewed site's
  `?host-dialog`) are in `apps/web/e2e/modal-dialog.spec.ts`; a modal menu, popovers, hover menus and
  frames (`?host-menus`) are in `apps/web/e2e/transient-ui.spec.ts`. Also check the add-comment, reply, resolve and inbox
  flows by hand in light and dark system themes.

Assignment uses `CommentAssignment` and the shared review service. The agent under the assignee
(`assignee.agent`, members only) is display-only here: only the assignee changes it, in the app or through MCP.
`src/agents.ts` (`@uier/toolbar/agents`) is the pure vocabulary both share: kinds, labels, `inferAgentKind`
and the one-colour marks. `useParticipants` fetches
a member-only, thread-filtered directory; composer mention ranges are maintained by `mentions.ts`.
Never infer recipients from display names or reveal account ids in guest DTOs.

- The badge is unread activity, not unresolved feedback. `useCommentsRefresh` is the sole adaptive
  scheduler: 15 seconds, then 30 after one minute without review activity, then 60 after two.
  Uier interactions after idle, changed successful responses and focus/online/visibility/expansion
  restore the fast cadence; returns refresh immediately. No hidden/offline/collapsed ticks or overlapping
  rounds. Keep its lifecycle and request-budget checks in `e2e/activity.spec.ts`; the full contract and
  measurements are in [review freshness](../../docs/review-workflow.md#polling-request-measurement). Read receipts merge
  monotonically across page/site caches. Inbox previews do not mark every listed thread read;
  short opened threads acknowledge after 800 ms only when `useVisitor` has a name or member session;
  unidentified visitors use Mark as read (the unread dot). `useUnreadComment` (Mark as unread, `DELETE comments/<id>/read`)
  sets the lowered cursor in every cache, since lists otherwise merge cursors upward; an open thread marked unread is
  not read automatically again until it is reopened. Keep resolve separate.
  Inbox Mark all as read snapshots only listed unread threads after every filter, including environment.
  `useReadComment` accepts a snapshot array and sends sequential batches of at most 200 to `comments/read`, merges successful
  receipts and refreshes lists/activity. Failed writes keep their original cursors for Retry; announce
  the actual written count with `useAnnounce`. A capped site list never acknowledges unlisted threads.

- `useActivitySummary` provides full unread/Open/In progress/Ready/Done counts separately from bounded text lists.
  The unread inbox requests `scope=site&unread=true`, including old threads outside the newest list.
  Refresh and mutation paths must invalidate the activity summary as well as page/site lists.

## Anchor recovery

`CommentAnchorDetails` shows anchors that need attention (moved text, hidden, missing, ambiguous) with
Reattach comment; a matching anchor stays quiet (`data-uier-anchor-state` only) and author/admin
reattachment is in the first message's menu (`useReattach`). An anchor in a closed menu, popover or
dialog (`closed`) is not broken: its line says which element opens it, without Reattach.
`layerAnchor.ts` (`withLayer`) saves that element when an anchor is chosen (new comments and
reattaching) while the layer is open: `modalLayer.ts`'s `layerOpener` finds the expanded
`aria-controls` trigger, else the `popovertarget`/`commandfor` invoker, outermost for nested layers;
its name is limited to the API's 120 visible characters. `getCommentPlacement` places a hidden or missing anchor
with a `layer` on that opener while it is shown and not expanded; areas are not outlined there.
`CommentsGlobal` reuses the point overlay and selection offsets, with a dockable confirm/cancel panel
and compact instructions while choosing. The saved thread is changed only after confirmation; collapse
cancels choosing. Anchor updates use `PATCH .../anchor`, the saved page key and expected revision.
Keep original and previous context, and never invent fallback pins for missing or ambiguous targets
(the saved opener of a closed layer is the one fallback).
`e2e/reattach*.spec.ts` covers recovery, access, races, layout changes and light/dark accessibility.

- Project review info supplies environment labels and explicit alias groups. Pins always use the
  current environment; inbox lists and activity use the saved environment chosen in the inbox's
  location picker (All environments until one is chosen).
  Scope query keys by that selection and reviewer. A thread's server-provided `source` owns its
  original link; missing/removed sources have no executable link. Keep foreign-environment items
  out of This page/Show on page even when paths match (the location picker keys pages by environment and path). Direct links override saved filters for the
  visit. Filter preferences use the versioned `uier:environment:v1:` key and contain no credentials.

## Review brief
`ProjectGate` passes fresh access and optional brief through `useProjectViewer`. Keep customer
retention claims out. Reviews have no first-run guide; the brief is in the inbox header only. The
landing hint's dismissal is browser-local (`uier:showcase-hint-dismissed`, boolean only). Feedback
mode must keep its requested form focused on mount. Briefs render only as text nodes with preserved
line breaks. No linkification or rich text.

The composite UI CSS source scan covers only `Timeago`, the sole `@signalco/ui` import. Add another
component's source if importing one; primitives retain their full source scan. Lightning CSS merges
equivalent rules before CSS injection; unused shadow-root `@property` registrations are removed,
but retain the unconditional properties fallback. All review shadow roots share one constructed
sheet; do not add plain style elements or require the host's `unsafe-inline` permission.

## Feedback export

`ExternalFeedbackLink` is a browser-safe provider/url type exported alongside the feedback
contract. Its values are projected separately on the server for current project members; never
put another destination's links into an outbound feedback packet or infer provider access from a
URL. Source synchronization versions, pending flags, deletion markers and credentials stay server-only.

`components/CopyIssue.tsx` reloads `/comments/:id/context` on each copy and provides a manual
Markdown fallback. Success appears beside the copy icon for two seconds without changing the
thread layout; the shared announcer reports it to screen readers. Errors and manual copy text
stay available until the reviewer retries or closes the text. `@uier/toolbar/feedback-context` is
the pure versioned model and deterministic formatter for toolbar/app and future integrations.
Titles, names and inline values use variable-length padded code spans to suppress GitHub/GitLab
autolinks and mentions; messages/quotes remain fenced and the structured context stays unchanged.
Authorization and private-field projection
belong on the server; never format a raw document or browser location for export. See
[the shared contract](../../docs/feedback-context.md).

## Optimistic status changes

`useComments` applies pending resolve/reopen changes to every cached page/site list, including
poll responses, and restores the previous status on failure. Pending changes carry the reviewer
revision; an old response must never repopulate a cache cleared by sign-out or lost access. Only
remove the pending entry owned by the settling mutation. Create/reply drafts retain their existing
immediate rendering, stable submission identity and failure recovery. The delayed-response browser
checks live in `apps/web/e2e/app-performance.spec.ts`.

## Packaged extension adapter

`src/extension.ts` configures `adapters.ts` before lazily importing `runtime.tsx`, the same mount
primitive used by the script entry. Configuration, transport, private images, draft storage, sign-out
and capture come from the trusted caller. Never read extension credentials from page globals.
`extensionContract.ts` is the v1 closed route/method contract for worker and backend. Keep it compatible
for one year after the last supported release. `coexistence.ts` is a secret-free DOM event handshake
so a mounted or late embed yields to extension activation across isolated worlds. DOM ids do not
prove ownership. `screenshotImage.tsx` uses byte-decoded canvas in extension mode for strict img-src.
See [browser-extension.md](../../docs/browser-extension.md) for unreleased status and hosted gate.

Packaged request adapter failures must become CommentsApiError(network_error), preserving the
shared retry/draft recovery behavior. Keep HTTP status parsing outside that transport catch.


## Priority and matching

`triage.ts` exports pure priority values/defaults and `matchesFeedbackSearch` for app/toolbar use.
Missing priority means Normal, including pinned responses. The thread header shows a priority other
than Normal to everyone; Thread options changes it only with `permissions.priority`, and a failed
intended value retains the submission key. The review API rechecks membership/private visibility and current public-project
staff policy. The control is shared by thread and inbox, with cache/activity invalidation through
`useComments`. No toolbar bulk operations. Feedback packets include priority as additive context.

## Fix verification

`verification.ts` is the pure public display contract, status helper and literal description.
`CommentVerification` is shared by thread popovers and inbox cards, with signalco controls (its
Request verification form opens from Thread options, whose button gets the focus back),
reviewer/admin permission flags and stable retry keys. Guest actor hashes never enter this model.
The status badge reads `feedbackStage`'s label: In progress for a thread in progress and Ready
to verify for pending unresolved requests; the ordinary action
says Done without verification. Confirmation requires the server's current request revision.
Workflow mutations refresh all lists/activity, preserve failed details and never auto-acknowledge
activity. Ready remains in Open counts, with its own filter. The extension contract adds the
same narrowly allowed verification POST; retain all supported older routes.
