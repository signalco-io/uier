# packages/toolbar - agent guide

The review toolbar: a small classic-script loader (`dist/index.js`) that a site includes. It loads
the separate review IIFE (`dist/review.js`, with CSS inlined) and mounts the comments UI into an
open shadow root when the page is opened with
a review link (`?toolbar-code=<project code>` or `?review=true`) or a project member signs in silently
(`review` mode; the review then lasts
for the tab, `src/review.ts`), always (`showcase` mode, every public uier.io page) or when the page asks
for feedback or a comment (`feedback` mode, the uier app's "Give feedback" button and C, `src/openFeedback.ts`). The link only
starts the review: the project whose comments apply is the script's `data-uier-project`
(`src/config.ts`). Configuration and bridge validation accept 21-character public Nano IDs and
legacy random 12-character codes; do not trim their alphabet to lowercase. `dist/react.js` is the React component that adds the script
(`@uier/toolbar/react`, `src/react.ts`, with a `project` prop), plus `openUierFeedback()` and `startUierComment()`. Embedding and configuration:
[README.md](README.md).

This guide holds the code map and the rules for every change in the toolbar. How a feature works,
and the rules that apply only to it, are in [`docs/`](docs/README.md), one note per area. Read the
note for the area you change and update it with the change; add rules here only when they apply to
every change in the package.

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
  `styles/toolbar-theme.css` sets `color-scheme` and a token `scrollbar-color` for both, so
  scrollbars follow the toolbar's theme, not the host page's.
- Fonts: `runtime.tsx` appends the self-hosted Geist stylesheet (`GEIST_FONTS_PATH` from
  `@uier/brand`, resolved against `toolbarConfig.apiUrl`) to the host document, because `@font-face` inside a shadow root is unreliable.
  If the host's CSP blocks it, the toolbar falls back to `system-ui`.
- The comments API base URL comes from `src/config.ts`: the script tag or `window.uierConfig`,
  else the toolbar script's origin, else the build-time `__UIER_API_URL__` (`tsup.config.ts`; the
  dev build always uses http://localhost:4004). Accept only plain window configuration with own
  string-valued data properties; ignore named elements, accessors, non-strings and read failures.
- The audit asset's bytes (`dist/audit.js`, axe-core for the Accessibility panel) produce a SHA-256 path and
  SHA-384 SRI embedded in the review script; then the final CSS-inlined review bytes produce a SHA-256 path and SHA-384 SRI embedded in the loader.
  The loader bytes produce `dist/bundle.json` (`@uier/toolbar/bundle`): its SHA-256 path and SHA-384 SRI.
  Each language but English (`dist/language-<code>.js`) is pinned in the review script the same way ([docs/localization.md](docs/localization.md)).
  The review script's closing license comment keeps each distinct notice once per bundled file (`withDistinctLicenses`):
  the UI kit's bundles repeat lucide-react's notice for every icon.
  The web build publishes default/pinned loaders and the review, audit and language assets, retaining them in its archive. Keep
  production pins/API compatibility for one year after last release as current (docs/api.md).
- UI-kit `next/link` imports in the embedded IIFE resolve to `components/ToolbarLink.tsx`, a
  ref-forwarding native anchor: reviewed sites need browser navigation, not Next.js routing.
  `process.env` remains stubbed to `{}` for browser compatibility of dependencies.
- "Exit review" unmounts the React root and removes `#uier-toolbar` (`runtime.tsx`). It is in the
  options and, when a project's reviewer can't comment, on the notice pill (`project/ProjectGate.tsx`).

## Components

Keep each row to one short line: the files, what they are, and the note in `docs/` that describes them. How
they behave goes in that note, not here.

| File | What |
| --- | --- |
| `components/CommentsGlobal.tsx` | the top level: pins, point mode, selections, focus after posting, the first-run hint, collapsing ([point mode](docs/point-mode.md)) |
| `components/CommentToolbar.tsx` | the black pill: its buttons, the point-mode instruction and Resume draft ([the pill](docs/pill-and-options.md), [keyboard](docs/keyboard.md)) |
| `src/shortcuts.ts`, `src/keyboard.ts`, `src/focusKeys.ts`, `src/threadShortcuts.ts` | the shortcuts, their switch and the composites' arrow keys ([keyboard](docs/keyboard.md)) |
| `components/ToolbarProfile.tsx`, `ToolbarOptions.tsx` | the profile and options popovers ([the pill](docs/pill-and-options.md#profile-and-options)) |
| `src/i18n/`, `src/languages.ts` | the six languages: catalogs, the language store, language assets and the codes shared with the app ([languages](docs/localization.md)) |
| `components/ToolbarFeedback.tsx`, `CommentKindLabel.tsx` | the feedback dialog (feedback or bug report about the page, no pin) and the "Feedback" / "Bug report" label of such threads |
| `components/InlineCommentThread.tsx` | live `data-uier-thread="<comment id>"` slots: same thread and reply composer as the pins, adopting the same constructed sheet in their shadow root, with cleanup; never auto-focus on load |
| `components/CommentBubble.tsx`, `CommentThread*.tsx`, `PinParticipants.tsx` | a pin and its thread popover: the header, menus and reply form ([threads](docs/comment-thread.md)) |
| `components/CommentPointOverlay.tsx` | point mode: the outline, the add-comment pointer, presses taken from the page, dragged areas ([point mode](docs/point-mode.md)) |
| `components/CommentAreaHighlight.tsx` | the dashed outline of a commented area ([point mode](docs/point-mode.md#areas)) |
| `components/canvas/`, `src/canvas/`, `src/drawing.ts` | canvas mode: the surface, its tool panel, the shapes' data and a comment's drawing on the page ([canvas mode](docs/canvas-mode.md)) |
| `components/CommentComposer.tsx` | the comment and reply form: the message editor, attachments, Discard and Send, drafts ([popovers](docs/composer-popovers.md#the-form)) |
| `src/editor/` | the rich message editor (`@uier/toolbar/editor`, ProseMirror), shared with the app ([message editor](docs/message-editor.md)) |
| `components/ComposerModal.tsx` | Expand / Collapse and the modal `<dialog>` a new comment or feedback expands to ([popovers](docs/composer-popovers.md#expanding-to-a-modal)) |
| `components/ComposerFooter.tsx` | the screen-reader-only key description under every composer ([keyboard](docs/keyboard.md)) |
| `components/CommentThreadItemMenu.tsx` | a message's options: edit, Reattach comment, delete; `CommentThreadItem.tsx` renders the edit ([threads](docs/comment-thread.md#message-options)) |
| `components/MessageReactions.tsx`, `hooks/useReactions.ts`, `src/reactions.ts` | emoji reactions to each message; the quick set is shared with the app and the API ([reactions](docs/reactions.md)) |
| `components/CommentErrorBoundary.tsx` | wraps every pin, highlight and sidebar thread: a comment that fails renders nothing |
| `components/CommentsErrorMessage.tsx`, `Toaster.tsx` | friendly messages for API errors, and toasts ([the pill](docs/pill-and-options.md#notices-by-the-pill)) |
| `components/Announcer.tsx` | the polite live region ("Comment posted", "Reply posted", "Comment deleted", "Reply deleted") |
| `components/ProjectNotice.tsx` | shared ink notice pill: one next step and Exit review, wrapping at narrow widths; button links retain coarse-pointer hit areas |
| `components/ShowcaseHint.tsx` | first-run hint and About uier: on uier.io's landing page only (showcase without a project, `showAbout` in `CommentsGlobal`), not on its other pages, in the app, in reviews or in embeds |
| `components/CommentIcon.tsx` | the outlined pin icon (Add comment), from `PIN_PATH` in `@uier/brand`; pins on the page are `<Pin />` from `@uier/brand` |
| `components/CommentSelectionHighlight.tsx` | the tint over a commented text range (`--brand-selection`), clickable for saved comments |
| `components/CommentSelectionPopover.tsx`, `RewriteIcon.tsx` | the toolbar for selected text: Add comment and Rewrite ([point mode](docs/point-mode.md#selected-text)) |
| `components/RewriteSuggestions.tsx`, `hooks/useRewriteSuggestions.tsx` | AI suggestions in a rewrite's form ([popovers](docs/composer-popovers.md#a-rewrite)) |
| `components/info/`, `hooks/useHoverPopover.ts` | the browser and device a comment was left from, and their details popover ([device details](docs/device-details.md)) |
| `src/screenshot.ts`, `components/CommentScreenshot.tsx`, `components/ComposerAttachments.tsx` | capture, Omit screenshot, Attach image and saved thumbnails ([screenshots](docs/screenshots.md)) |
| `src/screenshotPolicy.ts`, `src/suppliedScreenshot.ts`, `components/ScreenshotRedaction.tsx`, `hooks/useReplaceScreenshot.ts` | saved images: upload, paste and redaction ([screenshots](docs/screenshots.md#saved-images)) |
| `components/checks/`, `src/checks/` | the page-check panels and their checks ([page checks](docs/page-checks.md)) |
| `components/sidebar/` | the inbox: title row, filters, location picker, status tabs, drafts and the paged, virtualized list ([inbox](docs/inbox.md)) |
| `hooks/useComments.tsx`, `hooks/useVisitor.tsx` | React Query hooks for the comments and visitor APIs, or a project's review API ([realtime](docs/realtime.md)) |
| `project/ProjectGate.tsx`, `project/projectSession.ts` | project mode: who the reviewer is, what the project allows, the stored session ([project mode](docs/project-mode.md)) |
| `project/verification.ts` | cross-origin writes get a BotID proof through the API's `/review-verification` frame (no cookies); checks message origin and source, caches the proof in memory for under five minutes, fails closed |
| `project/backgroundSession.ts` | silent member sign-in through `/review-session` ([project mode](docs/project-mode.md#silent-member-sign-in)) |
| `project/installationCheck.ts` | the install page's `uier-check` diagnostics ([project mode](docs/project-mode.md#installation-check)) |
| `pageState.ts`, `hooks/usePagePath.tsx` | a page's canonical identity and source path, client-side navigation (`@uier/toolbar/page-state`) ([page identity](docs/page-state.md)) |
| `hooks/useCommentItemRects.tsx` | resolves anchors to rectangles and pin placements ([anchor recovery](docs/anchor-recovery.md#resolving-positions)) |
| `hooks/useLayoutVersion.ts` | shared geometry version for scroll (capture), resize, size and DOM changes; separate DOM evidence version for anchor/index invalidation, including observer restarts |
| `hooks/useReviewMovement.ts`, `components/DockablePanel.tsx` | moving the pill, docking panels, notices by the pill ([the pill](docs/pill-and-options.md#moving-and-docking)) |
| `hooks/useDrafts.tsx` | browser-local drafts, with `draftStorage.ts` ([popovers](docs/composer-popovers.md#drafts-across-reloads)) |

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
- `toolbarReview.ts` permits targeting every part of the toolbar (the pill, the inbox, threads,
  popovers and menus) only when the page and configured API share an origin; the review API refuses
  toolbar anchors from a project's sites. Stored `#uier-toolbar>>>` anchors cross only that shadow
  boundary; the API validates the inner selector with the existing restricted grammar. Keep part
  names stable (`toolbarParts.ts`), give a new toolbar popover `toolbarSurface(...)` (or leave it out
  of review on purpose), ignore annotation mutations in layout tracking, and include the reviewed
  parts (without pins, overlays, placement instructions or the comment being written) in screenshots
  only for these anchors. Text selection inside review UI remains excluded so reading and composing
  feedback does not start new drafts. Popovers held open, openers and tests:
  [docs/toolbar-review.md](docs/toolbar-review.md).
- Every user-facing string comes from the catalogs, in all six languages in the same change: `src/i18n/en.ts` and
  its translations (`useMessages()` in components, `messages()` elsewhere), and `src/i18n/lazy/` for the on-demand
  checks. No hardcoded text, no selectors or logic that match English words (use `data-uier-*` attributes), and no
  non-English catalog imported into the review bundle: those load as assets. See [docs/localization.md](docs/localization.md).
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
- Icon-only controls show their names with `IconTooltip` / `useIconTooltip`, never `title`
  ([docs/comment-thread.md](docs/comment-thread.md#icon-buttons)).
- Keep the loader below 7.5 KB raw / 3.1 KB gzip (`e2e/toolbar-assets.api.spec.ts`). React, styles,
  fonts and screenshots belong to the review bundle and must not load for ordinary visitors.
  Background member checks need only Authorization; keep guest-id generation out of the loader.
  `e2e/toolbar-bootstrap.spec.ts` covers deferred loading, configuration/identity handoff, concurrent
  requests, nonce/SRI, failure retries and feedback reopening. Keep the review bundle small: no new large dependencies without a reason (`modern-screenshot`, about
  25 KB, draws screenshots; there is no lighter way that keeps the page's own CSS; ProseMirror, about 240 KB, is
  the message editor in every composer, [docs/message-editor.md](docs/message-editor.md)). Published files may be
  up to 1.5 MB (`apps/web/scripts/toolbar-assets.mjs`). A large feature-only
  dependency becomes its own pinned asset loaded on use, like axe-core (`dist/audit.js`, [docs/page-checks.md](docs/page-checks.md)).
- Capture starts automatically for new feedback, and composers say so; Omit screenshot sends that one comment as text only,
  stops a capture still being taken (`cancelCommentScreenshot`; turning it off again takes a new one)
  (`CommentDraft.omitScreenshot` carries the choice through a failed send, in memory only). An attached own image (`useAttachedImage`,
  checked by `suppliedScreenshot` with the saved-evidence limits) replaces the capture in the create request and stays in memory
  (`CommentDraft.image`), never in draft/idempotency storage. Sending waits while it is read (`CommentComposer`'s
  `holdSubmit`); feedback clears it from the form on submit and a failed send restores it only into a form without a newer one. Redaction happens after saving. Saved thumbnails expand by click, tap or keyboard; failed image
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
  are in `apps/web/e2e/anchors.spec.ts`; composer keys (no visible hint, the description), no saved-draft line and Resume draft are in
  `apps/web/e2e/composer-hints.spec.ts` (desktop and mobile); the shortcuts, their switch and the composites'
  arrow keys are in `apps/web/e2e/shortcuts.spec.ts` (desktop); Add comment after or over an open thread
starting its own pin (never a reply) is in `apps/web/e2e/new-comment-after-thread.spec.ts`, and a member's
toolbar comment matching the app (pin number, avatar, follow state, no-reviewer request form) in
`apps/web/e2e/toolbar-app-parity.spec.ts`; native modal dialogs (the reviewed site's
  `?host-dialog`) are in `apps/web/e2e/modal-dialog.spec.ts`; a modal menu, popovers, hover menus and
  frames (`?host-menus`) are in `apps/web/e2e/transient-ui.spec.ts`. Also check the add-comment, reply, resolve and inbox
  flows by hand in light and dark system themes.

Assignment uses `CommentAssignment` and the shared review service. `assignees[]` groups each person's
`agents[]` (members only), falling back to the singular fields on older responses. The people picker
keeps several choices selected and uses atomic add/remove; Done closes it and Unassign clears everyone.
Agents are display-only here: only their own assignee changes them, in the app or through MCP.
`CommentActivity` shows the server-filtered member history in a compact, initially closed section,
oldest first with relative times. Keep raw actor/assignee ids and private-period filtering on the server;
see [thread history](../../apps/web/docs/read-state-and-activity.md#thread-history).
`src/agents.ts` (`@uier/toolbar/agents`) is the pure vocabulary both share: kinds, labels, `inferAgentKind`,
model names (`modelName`, `agentText`) and the one-colour marks. The optional `workingUntil` lease
shows a small spinner in `CommentAssignment` only while live. `@uier/toolbar/agent-working`
(`useAgentWorking`) expires it locally with a timer, even offline; reduced motion keeps it still.
Attachment and thread status are independent of the lease; [agent rules](../../apps/web/docs/assignee-agents.md). `src/devices.ts` (`@uier/toolbar/devices`) does the
same for the browser and OS a comment was left from: `browserKind` / `osKind` and their marks. `useParticipants` fetches
a member-only, thread-filtered directory; the composer's editor keeps each mention as one node and saves its range
([message editor](docs/message-editor.md)); `mentions.ts` (`moveMentions`) moves ranges for the API's text edits.
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
