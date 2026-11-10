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
  The web build publishes default/pinned loaders and the review and audit assets, retaining them in its archive. Keep
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
| `components/CommentToolbar.tsx` | the black pill (`nav` landmark): add comment, inbox with the blue unread count, Accessibility and SEO (from 640 px; in Options below), about, profile, options, collapse/expand (a `role="toolbar"`, one tab stop, ← → between them; the move handle beside it); the point-mode instruction (`role="status"`) and, in its place while a draft pin is closed, **Resume draft** (outside the pill, so its width never changes) |
| `src/shortcuts.ts`, `src/keyboard.ts`, `src/focusKeys.ts`, `src/threadShortcuts.ts` | the keyboard ([docs/keyboard.md](docs/keyboard.md)): C starts or ends point mode, or comments on a page text selection; G then I, `/`, J, K, R, S, A and `?` (`toolbarShortcuts`, listed in Options) in `CommentsGlobal`, a bubble-phase window listener, so a page that handles the key with `preventDefault` keeps it. Ignored with modifiers, key repeat and composition, in text fields and letter-key widgets (`isLetterKeyTarget`, across shadow roots), in the toolbar's dialogs (a thread's popover keeps the thread keys), while reattaching and while collapsed. Add comment names C in its tooltip (mono `kbd`, `IconTooltip`'s `shortcut`) and `aria-keyshortcuts`, as does the selection toolbar's Add comment. Options turns the single keys off per browser (WCAG 2.1.4; `uier:shortcuts-off`, boolean only, shared with the app through `@uier/toolbar/keyboard`). The pill and the inbox's status tabs are one tab stop (`useRovingFocus`), popovers of buttons move with ↑ ↓ (`moveFocusInMenu`) |
| `components/ToolbarProfile.tsx`, `ToolbarOptions.tsx` | the profile (guest or account name; signed in, its button shows the account's initial like the app's avatar) and the options (Keyboard shortcuts, their list, also on `?`, and the switch that turns them off, where a keyboard is likely; Accessibility and SEO on a narrow screen; reset moved toolbar, view project, exit review, sign out) popovers; on uier's own pages, account sign-out stays in the app's account menu. Options always ends with "Powered by uier", a link to uier.io (the toolbar runs on other people's sites). Every options row is an `OptionButton`: a 16 px icon (a list for Keyboard shortcuts, the toggle for the switch, a back arrow for All options, rotate-ccw for reset, the mark for "Powered by uier") 8 px from its label, so the icons line up in one column |
| `components/ToolbarFeedback.tsx`, `CommentKindLabel.tsx` | the feedback dialog (feedback or bug report about the page, no pin) and the "Feedback" / "Bug report" label of such threads |
| `components/InlineCommentThread.tsx` | live `data-uier-thread="<comment id>"` slots: same thread and reply composer as the pins, adopting the same constructed sheet in their shadow root, with cleanup; never auto-focus on load |
| `components/CommentBubble.tsx`, `CommentThread*.tsx` | a pin (`<Pin />` from `@uier/brand`: the issue number inside, the message count as its corner badge from the first reply, the name "Comment #6, 3 messages") with its thread popover (bounded by the window, clear of the pill) and reply form; one thread layout for popover and inbox, so an opened thread shows its messages and reply box first: `CommentThreadHeader.tsx` is one line (the status, a menu like the app's `StateMenu` (Open, In progress, Ready to verify, Done) for those who may change it, else a badge, `#id`, the blue unread dot that marks the thread read, a priority other than Normal, the assignee's avatar from `CommentAssignment.tsx` with the AI agent working under them stacked on it (`agents.ts` marks), named by its tooltip ("Assigned to you, with Claude"); then Copy, a menu with Copy issue and Copy link `?uier-comment=` (`src/review.ts`), each described, and Thread options, `CommentThreadMenu.tsx`, with the triage and email controls each person may use: assign (the people open under the line), priority, Request verification, Follow / Unfollow thread, Mute project emails and, once read, Mark as unread; no menu when there is none). The source line shows in the inbox, and on the page only when the original source is unavailable; messages have an avatar column and no dividers. Icon buttons show their names with `IconTooltip` / `useIconTooltip` (hover after 300 ms, at once on keyboard focus; portaled into the shadow root's container with a fixed position, decorative, never on touch): use it instead of `title` for icon-only controls. `CommentScreenshot` keeps the thumbnail alone: Upload image and Paste image are in its expanded view beside Redact screenshot (or beside "No screenshot"). The app's `CommentCard` follows the same layout, icons and words: change both together |
| `components/CommentPointOverlay.tsx` | point mode, without a cover over the page: presses that point at the page (`pointsAtPage`: outside the host; pins, highlights and frame shields; on uier's own pages the toolbar's parts, [docs/toolbar-review.md](docs/toolbar-review.md); trusted presses only) are taken on the window in the capture phase, before any page listener, and cancelled (focus, selection, drags, links, controls; touch is not cancelled, so it scrolls). Menus, popovers and dialogs that close on a press outside stay open, and moves still reach the page, so hover menus stay open too. Frames get transparent shields (`data-uier-shield`), since their presses go to their own document. It draws the outline of the element under the pointer and an add-comment pin beside a mouse or pen pointer (`data-uier-pointer`; the page keeps its cursor). The element is the topmost one whose own box holds the pointer, so a stretched link (`::after` over a row or card) does not hide the row's picture, summary or badges. A mouse or pen drag draws an area instead (`data-uier-drawing`), also when it ends over the toolbar: saved on the innermost element that holds it, as a point at its top-left corner with `widthNormal`/`heightNormal` (`isCommentArea`), so older toolbars still pin it; the click that ends a drag is ignored |
| `components/CommentAreaHighlight.tsx` | the dashed accent outline of a commented area (`data-uier-area`), with the selection tint while its thread is open; it never takes clicks (the pin opens the thread). Areas resolve to their rectangle in `useCommentItemRects`, so the pin sits at the bottom-right corner and the screenshot is the area |
| `components/CommentComposer.tsx` | the comment/reply text box (auto-growing textarea: Enter sends, Shift+Enter new line, `enterKeyHint`) in one bordered box with its `attachments` (Attach image), hint or counter and the send button (a plain icon button, since Enter sends; 44 px on touch screens), keeps drafts; `beforeText` goes between the quote and the box (a rewrite's suggestions) |
| `components/ComposerModal.tsx` | Expand / Collapse and the native modal `<dialog>` a new comment or feedback expands to for focused writing; the form's state stays with its owner ([docs/composer-popovers.md](docs/composer-popovers.md), also posting into the thread in one popover) |
| `components/ComposerFooter.tsx` | under every composer: "Draft saved in this browser" for a composer that opened with kept text (not feedback: `draftCue={false}`), and the screen-reader-only "Enter to send. Shift+Enter for a new line." (only with `any-pointer: fine`, `useKeyboardLikely`). No visible keyboard hint: the keys are in the shortcuts list (`toolbarShortcuts`). It describes the text box; keep it free of claims beyond browser-local storage |
| `components/CommentThreadItemMenu.tsx` | item options (edit with Save/Cancel and stale-edit protection; Reattach comment on the first message; delete with a confirmation); `CommentThreadItem.tsx` renders an inline `CommentComposer`, keeps failed text and returns focus to the menu |
| `components/CommentErrorBoundary.tsx` | wraps every pin, highlight and sidebar thread: a comment that fails renders nothing |
| `components/CommentsErrorMessage.tsx`, `Toaster.tsx` | friendly messages for API errors (`rate_limited` with `reason: "too_fast" \| "page_full"`, ...); a member's limit adds **View usage**, the API's usage page ([usage](../../apps/web/docs/usage.md)) |
| `components/Announcer.tsx` | the polite live region ("Comment posted", "Reply posted", "Comment deleted", "Reply deleted") |
| `components/ProjectNotice.tsx` | shared ink notice pill: one next step and Exit review, wrapping at narrow widths; button links retain coarse-pointer hit areas |
| `components/ShowcaseHint.tsx` | first-run hint and About uier: on uier.io's landing page only (showcase without a project, `showAbout` in `CommentsGlobal`), not on its other pages, in the app, in reviews or in embeds |
| `components/CommentIcon.tsx` | the outlined pin icon (Add comment), from `PIN_PATH` in `@uier/brand`; pins on the page are `<Pin />` from `@uier/brand` |
| `components/CommentSelectionHighlight.tsx` | the tint over a commented text range (`--brand-selection`), clickable for saved comments |
| `components/CommentSelectionPopover.tsx`, `RewriteIcon.tsx` | the toolbar for selected text (`role="toolbar"`, "Selected text"): Add comment, Rewrite; ink and the pill's height (36 px buttons), the add-comment pin and the custom rewrite icon (text lines and a pencil) |
| `components/RewriteSuggestions.tsx`, `hooks/useRewriteSuggestions.tsx` | AI suggestions in a rewrite's form, above its text box (`POST /api/rewrite`): the instruction box with Suggest inside, then the suggestions; their state (`useRewriteSuggestionsState`) belongs to `CommentBubble`, so Expand keeps it ([docs/composer-popovers.md](docs/composer-popovers.md#a-rewrite)) |
| `components/info/`, `hooks/useHoverPopover.ts` | `getDeviceInfo` (read when feedback/capture starts; names from `src/userAgent.ts`, which parses client hints or the user-agent string in the browser and never sends the string; `completeDeviceInfo` adds Chromium's high-entropy OS version and model before a post) and `CommentDevice`, the app's `CommentDevice` in the toolbar: after the first message's time, a desktop/tablet/mobile icon (only when the size is known) and the browser's mark (`DeviceMark.tsx` over `src/devices.ts`, a globe when unknown; only with the API's member-only `reproduction` field). Their popover opens on hover without moving focus, stays open after a click, and Enter moves focus in (Escape returns it, without closing the thread or inbox); it lists the screen (size, viewport, pixel ratio), browser and OS each with its mark, the recorded model, input, colour scheme, reduced motion and page language (`deviceSettings`), capture time, the Reviewed page link and Copy reproduction details. Guests and public viewers get the screen row only. `useHoverPopover` focuses the first button itself: Radix's first focus fails in a shadow root |
| `src/screenshot.ts`, `components/CommentScreenshot.tsx`, `components/ComposerAttachments.tsx` | automatic screenshots: the region of a new comment, drawn from the page without the toolbar (`modern-screenshot`, the scroll as a negative margin so fixed elements stay, fonts inlined, the content of `data-uier-decorative` elements left out: they keep their `min-height`), encoded under the API's limits; capture starts from the feedback event (the window, its scroll and inner scroll are read then), but copies the page only after the composer's first frame, in about 8 ms pieces that yield to the page (`scheduler.yield`, else a message), leaving out blocks more than a window's size from the window (all of a block below it in a block's flow, else its content: the copy keeps every element's `width`/`height`; sticky elements and shadow roots are always kept), and encodes with `toBlob` (#319); restored/reopened drafts refresh it without persisting images, and saved thumbnails expand in a shadow-root popover. New comment and feedback forms render `ComposerAttachmentsHeader` above (not inside) `CommentComposer`: the title, then a screen toggle with its tooltip (**Omit screenshot**, `aria-pressed`, a crossed-out screen when pressed, described by the read-out capture status) that leaves `screenshot` out of the request, and Expand. **Attach image** (`ComposerAttachButton`: the reviewer's own image, picked or pasted into the form, sent as `screenshot` instead of the capture; once attached, its name with a remove button) is in the text box's bottom-left corner (`CommentComposer`'s `attachments`), so it reads as a part of the comment; never an image preview |
| `src/screenshotPolicy.ts`, `src/suppliedScreenshot.ts`, `components/ScreenshotRedaction.tsx`, `hooks/useReplaceScreenshot.ts` | saved evidence upload/paste and opaque rectangle redaction, using shared API limits; replacements invalidate cached originals and update all comment lists. Redaction opens only from expanded saved details; composers never preview images |
| `components/checks/`, `src/checks/` | the Accessibility and SEO panels ([docs/page-checks.md](docs/page-checks.md)): pill buttons from 640 px (Options below), docked like the inbox, one of them or the inbox open at a time; axe-core is the lazy, pinned `dist/audit.js` asset (`checks/axeLoader.ts`), the SEO checks and Core Web Vitals read the page's own document; Highlight, and Comment posting an issue in one click through the new-comment create |
| `components/sidebar/` | the inbox sidebar (ink, radius 16): the search on top, then `LocationPicker` (the app's two-column location filter in the UI kit's `Popper`: a project's environments on the left, then pages with a search: this page by default, all pages, sections (`section:/blog`, also from a typed path) or one other page, each with its matching count) with the Unread and Assigned to me filters (outlined toggles like the app's Unread; the search and filters sit closer together than the title and tabs), then the app's status tabs counted for the chosen pages: Active (the default, everything not done), Done and All, with the Active statuses menu beside Active for Open, In progress or Ready to verify (the Active tab then names the choice; [comment filters](../../apps/web/docs/comment-filters.md)), then the list (`useInboxComments.ts`, `CommentsFilter.tsx`). Cards end with Show on page (this page) or a link to their page; an empty "this page" offers the other pages' matches; Unread lists all pages. The list renders its first 20 threads with the panel and the rest in a deferred render, so a long inbox opens without a long task |
| `hooks/useComments.tsx`, `hooks/useVisitor.tsx` | React Query hooks against the comments and visitor APIs (`hooks/api.ts`: requests, errors, query keys); with a project, the project's review API. A change to a comment updates every cached list that has it (the page's and the site's) |
| `project/ProjectGate.tsx`, `project/projectSession.ts` | project mode (`data-uier-project`): who the reviewer is and what the project allows (comments, or a notice with Exit review: sign in, comments off), the review token, guest name and visitor id in the reviewed site's `localStorage` |
| `project/verification.ts` | cross-origin writes get a BotID proof through the API's `/review-verification` frame (no cookies); checks message origin and source, caches the proof in memory for under five minutes, fails closed |
| `project/backgroundSession.ts` | silent member sign-in through `/review-session`; exact frame/origin/nonce checks, one three-second attempt per page, no popups or storage-access prompts. Sign-out opt-out and tab Exit review take precedence; only authorized members auto-open without a link |
| `project/installationCheck.ts` | explicit `uier-check` nonce flow: public configuration/status reports to the install page, bounded lifetime, browser CSP evidence, read API and verification proof; never posts a test comment or sends tokens in a diagnostic report |
| `pageState.ts`, `hooks/usePagePath.tsx` | shared browser/server canonical identity (pathname by default; approved query fields and optional hash routes), `sourcePagePath`/`storedSourcePath` (the same filtering with trailing slashes kept, for links only, never a key), the names of other selectable query fields sent with new project comments for the settings suggestions (`pageQueryKeys`), SPA history/hash subscriptions with cleanup and a fallback; exported as `@uier/toolbar/page-state` |
| `hooks/useCommentItemRects.tsx` | resolves positions to rectangles and pin placements; offsets are verified, then a lazy whitespace-free page index is shared by every comment, with one record per text node. Exact/restored/missing/ambiguous results persist until the DOM version changes; geometry/visibility is remeasured on layout frames. No pin for missing/ambiguous/hidden anchors; never throws |
| `hooks/useLayoutVersion.ts` | shared geometry version for scroll (capture), resize, size and DOM changes; separate DOM evidence version for anchor/index invalidation, including observer restarts |
| `hooks/useReviewMovement.ts`, `components/DockablePanel.tsx` | shared pointer/touch handles, visible viewport bounds, toolbar position and reusable panel docking; versioned browser-local preferences and keyboard alternatives. `useToolbarNotice` places a notice by the pill (the point-mode instruction, Resume draft, toasts, the load error): centred on it, above it, or below when there is no room above, inside the viewport, so it never covers the pill |
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
  25 KB, draws screenshots; there is no lighter way that keeps the page's own CSS). A large feature-only
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
  are in `apps/web/e2e/anchors.spec.ts`; composer keys (no visible hint, the description), the saved-draft cue and Resume draft are in
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
