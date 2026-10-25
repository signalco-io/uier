# packages/toolbar - agent guide

The review toolbar: one classic-script bundle (`dist/index.js`, an IIFE with the CSS inlined) that a
site includes and that mounts the comments UI into an open shadow root, when the page is opened with
a review link (`?toolbar-code=<project code>` or `?review=true`, `review` mode; the review then lasts
for the tab, `src/review.ts`) or always (`showcase` mode, every public uier.io page). The link only
starts the review: the project whose comments apply is the script's `data-uier-project`
(`src/config.ts`). `dist/react.js` is the React component that adds the script
(`@uier/toolbar/react`, `src/react.ts`, with a `project` prop). Embedding and configuration:
[README.md](README.md).

## How it is built

- `src/index.tsx` creates `<div id="uier-toolbar">`, attaches an open shadow root (so assistive
  technologies, axe and Playwright can reach it), injects the compiled CSS (tsup replaces the `__uier_toolbar_css__` placeholder with `dist/index.css`,
  see `tsup.config.ts`) and renders `CommentsBootstrapper` into a `<div data-uier-root>` inside it.
- Styles: Tailwind v4 (`src/index.css`) with the signalco minimal theme preset and
  **`@uier/brand/tokens.css`**. The tokens use `:root, :host`, so they apply inside the shadow
  root (`:root` alone would not). The `[data-uier-root]` container gets the `dark` class when the
  system prefers dark, so threads follow the system theme; the pill and the sidebar are wrapped in
  `components/InkScope.tsx` (always the dark tokens), pins are always ink.
- Fonts: `index.tsx` appends the Google Fonts stylesheet for Geist (`GEIST_FONTS_URL` from
  `@uier/brand`) to the host document, because `@font-face` inside a shadow root is unreliable.
  If the host's CSP blocks it, the toolbar falls back to `system-ui`.
- The comments API base URL comes from `src/config.ts`: the script tag or `window.uierConfig`,
  else the toolbar script's origin, else the build-time `__UIER_API_URL__` (`tsup.config.ts`; the
  dev build always uses http://localhost:4004).
- `process.env` is stubbed to `{}` because `next/link` (pulled in by the UI kit) reads it.
- "Exit review" unmounts the React root and removes `#uier-toolbar` (`index.tsx`). It is in the
  options and, when a project's reviewer can't comment, on the notice pill (`project/ProjectGate.tsx`).

## Components

| File | What |
| --- | --- |
| `components/CommentsGlobal.tsx` | top level: pins (in page order), point mode and its keyboard path, selection handling, focus after posting, the first-run hint; collapsing hides the on-page review layer and cancels placement/selection controls, keeping draft text and inbox state |
| `components/CommentToolbar.tsx` | the black pill (`nav` landmark): add comment, inbox with the blue unread count, about, profile, options, collapse/expand; the point-mode instruction (`role="status"`) |
| `components/ToolbarProfile.tsx`, `ToolbarOptions.tsx` | the profile (guest name) and the options (reset moved toolbar, view project, exit review, sign out) popovers |
| `components/ToolbarFeedback.tsx`, `CommentKindLabel.tsx` | the feedback dialog (feedback or bug report about the page, no pin) and the "Feedback" / "Bug report" label of such threads |
| `components/InlineCommentThread.tsx` | live `data-uier-thread="<comment id>"` slots: same thread and reply composer as the pins, in their own styled shadow root; never auto-focus on load |
| `components/CommentBubble.tsx`, `CommentThread*.tsx` | a pin with its thread popover (bounded by the window, clear of the pill) and reply form; `CommentThreadHeader.tsx` is the status, Mark as done / Reopen and Copy link (`?uier-comment=`, `src/review.ts`) |
| `components/CommentPointOverlay.tsx` | point mode: the pin cursor, the outline of the element under the pointer, the click that pins |
| `components/CommentComposer.tsx` | the comment/reply text box (auto-growing textarea: Enter sends, Shift+Enter new line), keeps drafts |
| `components/CommentThreadItemMenu.tsx` | item options (edit with Save/Cancel and stale-edit protection; delete with a confirmation); `CommentThreadItem.tsx` renders an inline `CommentComposer`, keeps failed text and returns focus to the menu |
| `components/CommentErrorBoundary.tsx` | wraps every pin, highlight and sidebar thread: a comment that fails renders nothing |
| `components/CommentsErrorMessage.tsx` | friendly messages for API errors (`rate_limited` with `reason: "too_fast" \| "page_full"`, ...) |
| `components/Announcer.tsx` | the polite live region ("Comment posted", "Reply posted", "Comment deleted", "Reply deleted") |
| `components/ShowcaseHint.tsx` | the first-run hint (showcase mode) |
| `components/CommentIcon.tsx` | the pin shape, from `PIN_PATH` in `@uier/brand` |
| `components/CommentSelectionHighlight.tsx` | the tint over a commented text range (`--brand-selection`), clickable for saved comments |
| `components/CommentSelectionPopover.tsx` | the toolbar for selected text (`role="toolbar"`, "Selected text"): Add comment, Rewrite |
| `components/RewriteSuggestions.tsx`, `hooks/useRewriteSuggestions.tsx` | AI suggestions under a rewrite's text box (`POST /api/rewrite`) |
| `components/info/` | `getDeviceInfo` (read when feedback/capture starts) and `CommentDeviceMeta` (coarse device/viewport for everyone, expandable/copyable original reproduction details only when the API supplies the member-only `reproduction` field) |
| `src/screenshot.ts`, `components/CommentScreenshot.tsx` | automatic screenshots: the region of a new comment, drawn from the page without the toolbar (`modern-screenshot`, the scroll as a negative margin so fixed elements stay, fonts inlined), encoded under the API's limits; capture starts from the feedback event, restored/reopened drafts refresh it without persisting images, and saved thumbnails expand in a shadow-root popover |
| `src/screenshotPolicy.ts`, `src/suppliedScreenshot.ts`, `components/ScreenshotRedaction.tsx`, `hooks/useReplaceScreenshot.ts` | saved evidence upload/paste and opaque rectangle redaction, using shared API limits; replacements invalidate cached originals and update all comment lists. Redaction opens only from expanded saved details; composers never preview images |
| `components/sidebar/` | the inbox sidebar (ink, radius 16): this page and the site's other pages in both modes, the status filter and search (`CommentsFilter.tsx`) |
| `hooks/useComments.tsx`, `hooks/useVisitor.tsx` | React Query hooks against the comments and visitor APIs (`hooks/api.ts`: requests, errors, query keys); with a project, the project's review API. A change to a comment updates every cached list that has it (the page's and the site's) |
| `project/ProjectGate.tsx`, `project/projectSession.ts` | project mode (`data-uier-project`): who the reviewer is and what the project allows (comments, or a notice with Exit review: sign in, comments off), the review token, guest name and visitor id in the reviewed site's `localStorage` |
| `project/verification.ts` | cross-origin writes get a BotID proof through the API's `/review-verification` frame (no cookies); checks message origin and source, caches the proof in memory for under five minutes, fails closed |
| `project/installationCheck.ts` | explicit `uier-check` nonce flow: public configuration/status reports to the install page, bounded lifetime, browser CSP evidence, read API and verification proof; never posts a test comment or sends tokens in a diagnostic report |
| `pageState.ts`, `hooks/usePagePath.tsx` | shared browser/server canonical identity (pathname by default; approved query fields and optional hash routes), SPA history/hash subscriptions with cleanup and a fallback; exported as `@uier/toolbar/page-state` |
| `hooks/useCommentItemRects.tsx` | resolves stored positions to rectangles and pin placements: text offsets across an element's text nodes, the stored text verified and searched for when it moved, a fallback pin when it is gone, nothing for hidden anchors; never throws (invalid selectors, out-of-range offsets) |
| `hooks/useLayoutVersion.ts` | one shared "measure again" signal: scroll (capture), resize, size and DOM changes of the page |
| `hooks/useReviewMovement.ts`, `components/DockablePanel.tsx` | shared pointer/touch handles, visible viewport bounds, toolbar position and reusable panel docking; versioned browser-local preferences and keyboard alternatives |
| `hooks/useDrafts.tsx` | seven-day browser-local text/anchor/edit snapshots scoped to API/project/authorized reviewer/canonical page/item; `draftStorage.ts` handles expiry, discard, sign-out clearing, blocked storage and stable submission identities; captures stay in memory and refresh on reopen |

## Rules

- The review layer is always ink: the pill and the sidebar render inside `InkScope` (dark tokens)
  and pins are ink, whatever the host page looks like. Thread popovers and the hint use the theme
  tokens (`bg-popover`, `text-foreground`) so they follow light/dark. Blue (`--brand-accent`) only
  for the focus ring, the selection tint, the unread count and links. See
  `packages/brand/BRAND.md`, "The review layer".
- Stored comments come from anonymous visitors: resolve positions only through
  `hooks/useCommentItemRects.tsx` (`safeQuerySelector`, clamped offsets) and keep every comment
  inside a `CommentErrorBoundary`, so one bad comment can never take the toolbar down.
- Everything rendered must work inside a shadow root on an unknown page: no global CSS, no
  assumptions about the host's fonts or variables, no `document.body` styling.
- Cross-site embeds require `data-uier-project`. The project's addresses decide CORS; the install
  guide includes the API origin in `frame-src`. Failed comment loads show a message and retry action.
- UI comes from `@signalco/ui-primitives` / `@signalco/ui`; icons from `@signalco/ui-icons`
  (Lucide, 1.75 stroke). Do not add Next.js-only imports; this runs in any page.
- Keep the bundle small: no new large dependencies without a reason (`modern-screenshot`, about
  25 KB, draws screenshots; there is no lighter way that keeps the page's own CSS).
- Capture starts automatically for new feedback. Image selection and redaction happen after saving,
  outside draft/idempotency storage. Saved thumbnails expand by click, tap or keyboard; failed image
  replacement retains feedback and reports the error. Keep the API's revision check on replacements.
- Coarse pointers get a 44 px minimum button hit area from `styles/toolbar-theme.css`, including
  compact UI-kit movement and thread controls. Preserve this when changing toolbar/panel layouts.

## Working on it

- `pnpm dev` at the repository root rebuilds on change and serves `dist/` on
  http://localhost:4005; the web app loads it in development. Open
  http://localhost:4004/?review=true (or any page, e.g. `/brand?review=true`).
- `pnpm -C packages/toolbar build` produces the production bundle; `pnpm typecheck` checks it.
- End-to-end tests run the built toolbar on the landing page: `apps/web/e2e/showcase.spec.ts`
  (desktop and mobile, with axe checks), and on a reviewed site on another origin:
  `apps/web/e2e/embed.spec.ts`; review links and the pill's controls are in
  `apps/web/e2e/review.spec.ts`; the inbox is in `apps/web/e2e/inbox.spec.ts`; a project's site (the
  script tag, the React component, the notices and their Exit review) is in
  `apps/web/e2e/project-review.spec.ts`; pins and highlights after a reload, a scroll and a resize
  are in `apps/web/e2e/anchors.spec.ts`. Also check the add-comment, reply, resolve and inbox
  flows by hand in light and dark system themes.

- The badge is unread activity, not unresolved feedback. `useCommentsRefresh` is the sole 15-second
  foreground scheduler (focus/online/visibility/expansion refresh immediately). Read receipts merge
  monotonically across page/site caches. Inbox previews do not mark every listed thread read;
  short opened threads acknowledge after 800 ms, otherwise use Mark as read. Keep resolve separate.

- `useActivitySummary` provides full unread/Open/Done counts separately from bounded text lists.
  The unread inbox requests `scope=site&unread=true`, including old threads outside the newest list.
  Refresh and mutation paths must invalidate the activity summary as well as page/site lists.
