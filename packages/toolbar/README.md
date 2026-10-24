# @uier/toolbar

The uier toolbar: a comments overlay that is injected into a page, so visitors and teammates can leave
feedback pinned to an element (point comments) or to selected text.

## Embedding

The bundle (`dist/index.js`) is a classic script (an IIFE, so nothing leaks into the page's globals).
The web app serves it at `/toolbar.js`:

```html
<script src="https://uier.io/toolbar.js" data-uier-mode="showcase" defer></script>
```

Configuration is read synchronously while the script runs (`src/config.ts`), from the script tag's data
attributes or from `window.uierConfig`, set before the script:

```html
<script>window.uierConfig = { mode: 'showcase', apiUrl: 'https://uier.io' };</script>
```

| Option | Script attribute | `window.uierConfig` | Default |
| --- | --- | --- | --- |
| Mode | `data-uier-mode` | `mode` | `review` |
| API base URL | `data-uier-api-url` | `apiUrl` | origin of the script URL |

- `review` mode mounts the toolbar only when the page URL contains `?review=true`.
- `showcase` mode (the uier landing page) always mounts it and shows a dismissible first-run hint above the
  toolbar (dismissal is remembered in `localStorage`, key `uier:showcase-hint-dismissed`; the "About uier"
  button shows it again).
- The API base URL defaults to the origin of the toolbar script (`document.currentScript.src`), so a
  preview deployment's toolbar talks to that preview's API. When there is no script URL (e.g. loaded as a
  module script), the build-time `__UIER_API_URL__` is used (`https://uier.io`). The development build
  always uses `__UIER_API_URL__` (`http://localhost:4004`), because the toolbar dev server only serves the
  bundle.

## Comments API

`src/hooks/useComments.tsx` calls `<apiUrl>/api/comments` with `credentials: 'include'`; the API identifies
anonymous visitors with its HttpOnly `uier_visitor` cookie. Comments are public: every visitor sees the
unresolved comments of the page (`?path=` is `location.pathname` without a trailing slash) and can reply.
Only the author of a comment can resolve, reopen or delete it, and only the author of a reply can delete
that reply (the API returns `isMine` / `author.isMe`). Texts are limited to 1000 characters. API errors
(`rate_limited`, `too_large`, `bot_detected`, ...) are shown as friendly inline messages
(`src/components/CommentsErrorMessage.tsx`).

## UI and styles

- `src/index.tsx` mounts the toolbar into an open shadow root on `<div id="uier-toolbar">` (open so
  assistive technologies, accessibility checks and end-to-end tests can reach it). Nothing else is
  rendered into the page, except the highlight of commented text.
- Styles are compiled with Tailwind CSS v4 (`src/index.css`, `postcss.config.mjs`) and inlined into
  `dist/index.js` at build time (see `tsup.config.ts`, placeholder `__uier_toolbar_css__`).
- The toolbar always uses a dark theme (`src/styles/toolbar-theme.css`, variables on `:host`), with text
  contrast of at least 7:1 on its surfaces, independent of the page's colors and fonts.
- UI components come from the `@signalco/*` UI kit; `src/styles/tailwind-v3-compat.css` keeps the kit's
  Tailwind v3 class names rendering as they did with Tailwind v3.

## Scripts

- `pnpm build` - production bundle in `dist/index.js` (CSS included)
- `pnpm dev` - rebuild on change and serve `dist` on http://localhost:4005 (loaded by `apps/web` in development)
- `pnpm typecheck` - type check with `tsc`
