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
  button shows it again). The hint also closes, and stays closed, once the visitor starts a comment.
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
(`src/components/CommentsErrorMessage.tsx`); a `rate_limited` body's `reason` tells a full page
(`page_full`) from a visitor who sends too fast (`too_fast`, also when `reason` is missing), and
`Retry-After` gives the wait. `GET` lists at most 200 comments, so a full list shows as "200+".

Stored positions are untrusted (anyone can post one): an invalid selector or an out-of-range offset
resolves to "not on this page" (`src/hooks/useCommentItemRects.tsx`), and every comment renders inside an
error boundary, so one bad comment never breaks the toolbar.

## Using it

- Point comments: the + button starts point mode (an instruction shows above the pill, Esc cancels), then
  a click pins the comment. With the keyboard, focus an element on the page, Tab to the + button and press
  Enter: the comment is pinned to that element (Enter on a focused element in point mode does the same).
- Text comments: select text, then "Comment...".
- The text box grows with the text; Enter posts, Shift+Enter adds a new line. Unsent text is kept when the
  popover closes (a new comment stays as a draft pin until it is posted or discarded).
- After posting, the focus moves to the new pin and "Comment posted" / "Reply posted" is announced.

## UI and styles

- `src/index.tsx` mounts the toolbar into an open shadow root on `<div id="uier-toolbar">` (open so
  assistive technologies, accessibility checks and end-to-end tests can reach it). Nothing else is
  rendered into the page, except the highlight of commented text.
- Styles are compiled with Tailwind CSS v4 (`src/index.css`, `postcss.config.mjs`) and inlined into
  `dist/index.js` at build time (see `tsup.config.ts`, placeholder `__uier_toolbar_css__`).
- Colors come from `@uier/brand/tokens.css`. The pill, the pins and the inbox sidebar are always ink
  (`src/components/InkScope.tsx`); thread popovers and the hint follow the system light/dark theme.
  `src/styles/toolbar-theme.css` keeps the page's inherited text styles out and honours reduced motion.
- UI components come from the `@signalco/*` UI kit; `src/styles/tailwind-v3-compat.css` keeps the kit's
  Tailwind v3 class names rendering as they did with Tailwind v3.

## Scripts

- `pnpm build` - production bundle in `dist/index.js` (CSS included)
- `pnpm dev` - rebuild on change and serve `dist` on http://localhost:4005 (loaded by `apps/web` in development)
- `pnpm typecheck` - type check with `tsc`
