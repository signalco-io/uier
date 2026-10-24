# packages/toolbar - agent guide

The review toolbar: a single ESM bundle (`dist/index.js`, CSS inlined) that a site includes and
that mounts the comments UI into a closed shadow root when the page URL has `?review=true`.

## How it is built

- `src/index.tsx` creates `<div id="uier-toolbar">`, attaches a closed shadow root, injects the
  compiled CSS (tsup replaces the `__uier_toolbar_css__` placeholder with `dist/index.css`,
  see `tsup.config.ts`) and renders `CommentsBootstrapper` into a `<main>` inside it.
- Styles: Tailwind v4 (`src/index.css`) with the signalco minimal theme preset and
  **`@uier/brand/tokens.css`**. The tokens use `:root, :host`, so they apply inside the shadow
  root (`:root` alone would not). The `<main>` gets the `dark` class when the system prefers
  dark, so threads follow the system theme while the toolbar and pins stay ink.
- Fonts: `index.tsx` appends the Google Fonts stylesheet for Geist (`GEIST_FONTS_URL` from
  `@uier/brand`) to the host document, because `@font-face` inside a shadow root is unreliable.
  If the host's CSP blocks it, the toolbar falls back to `system-ui`.
- The comments API base URL is the build-time constant `__UIER_API_URL__` (`tsup.config.ts`):
  the dev build talks to http://localhost:4004, production builds to https://uier.io.
- `process.env` is stubbed to `{}` because `next/link` (pulled in by the UI kit) reads it.

## Components

| File | What |
| --- | --- |
| `components/CommentsGlobal.tsx` | top level: pins, bubbles, selection handling, device info capture |
| `components/CommentToolbar.tsx` | the black pill toolbar (add comment, inbox) |
| `components/CommentBubble.tsx`, `CommentThread*.tsx` | a pin with its thread popover and reply form |
| `components/CommentIcon.tsx` | the pin shape, from `PIN_PATH` in `@uier/brand` |
| `components/CommentSelectionHighlight.tsx` | the tint over a commented text range (`--brand-selection`) |
| `components/sidebar/` | the inbox sidebar (black, radius 16) |
| `hooks/useComments.tsx` | React Query hooks against the comments API |

## Rules

- The review layer is always ink: toolbar, pins and sidebar are `bg-black` with a
  `border-neutral-800` ring whatever the host page looks like. Thread popovers use the theme
  tokens (`bg-background`, `text-foreground`) so they follow light/dark. See
  `packages/brand/BRAND.md`, "The review layer".
- Everything rendered must work inside a shadow root on an unknown page: no global CSS, no
  assumptions about the host's fonts or variables, no `document.body` styling.
- UI comes from `@signalco/ui-primitives` / `@signalco/ui`; icons from `@signalco/ui-icons`
  (Lucide, 1.75 stroke). Do not add Next.js-only imports; this runs in any page.
- Keep the bundle small: no new large dependencies without a reason.

## Working on it

- `pnpm dev` at the repository root rebuilds on change and serves `dist/` on
  http://localhost:4005; the web app loads it in development. Open
  http://localhost:4004/?review=true (or any page, e.g. `/brand?review=true`).
- `pnpm -C packages/toolbar build` produces the production bundle; `pnpm typecheck` checks it.
- There are no automated tests for the toolbar yet; check the add-comment, reply, resolve and
  inbox flows by hand in light and dark system themes.
