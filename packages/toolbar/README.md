# @uier/toolbar

The uier review toolbar: a comments overlay that is injected into the page being reviewed.

- `src/index.tsx` mounts the toolbar into a closed shadow root when the page URL contains `?review=true`.
- Styles are compiled with Tailwind CSS v4 (`src/index.css`, `postcss.config.mjs`) and inlined into
  `dist/index.js` at build time (see `tsup.config.ts`, placeholder `__uier_toolbar_css__`).
- UI components come from the `@signalco/*` UI kit; `src/styles/tailwind-v3-compat.css` keeps the kit's
  Tailwind v3 class names rendering as they did with Tailwind v3.

## Scripts

- `pnpm build` - production bundle in `dist/index.js` (CSS included)
- `pnpm dev` - rebuild on change and serve `dist` on http://localhost:4005 (loaded by `apps/web` in development)
- `pnpm typecheck` - type check with `tsc`

Comments are read from and written to `https://uier.io/api/comments` (`src/hooks/useComments.tsx`).
The development build (`pnpm dev`) uses the local web app's API instead, `http://localhost:4004/api/comments`
(the base URL is the build-time constant `__UIER_API_URL__`, set in `tsup.config.ts`).
