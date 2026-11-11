# Social cards and link previews

Every link to uier.io unfurls with its own title, description and 1200 × 630 card (BRAND.md,
"Marketing and metadata"). The root layout sets no Open Graph title, description or URL, so pages
outside `publicPageMetadata` fall back to their own.

- **A public page** draws its card in an `opengraph-image.tsx` next to its `page.tsx`, with the same
  title and description as its metadata (`legal/sla/opengraph-image.tsx` is the pattern):

  ```tsx
  const card: PageCard = { section: 'Legal', title: 'Service level agreement', description: '...', path: '/legal/sla' };
  export const alt = pageCardAlt(card);
  export const size = socialCardSize;
  export const contentType = socialCardContentType;
  export default function Image() { return pageCardImage(card); }
  ```

  `section` is an optional label top right; an integration passes `provider` for its logo instead.
  Next adds the file to the page's Open Graph and X tags because `publicPageMetadata` sets no
  `images` (and suffixes its address inside route groups). A page without a title is the landing
  page and gets the brand card; the root file is not inherited once a page sets its own Open Graph.
- **App links** are previewed signed out, so a comment, review or project link ends at sign in
  (`?next=`) and an invitation at its page. `describeAppLink` names the kind of link and, for review
  links, the site's host from the link's own `url`; it reads nothing from the store, so a preview
  never shows a comment, project, workspace or person. The browser tab keeps "Sign in".
- Cards draw no text from a request: `/og/[card]` prerenders `linkCards` and 404s anything else.
  Pictures are specimens with placeholder bars, never words that read as someone's content.
  The sitemap excludes `*/opengraph-image*` and `/og/*`.

With Cache Components, the immutable Geist font bytes use `cacheLife('max')` in
`socialCardFonts`. They serialize as ArrayBuffers, keeping the cards prerenderable without caching
request values. `/og/[card]` uses its existing runtime allowlist for unknown ids instead of the
removed `dynamicParams` setting.

The three Geist TTFs use literal `new URL(..., import.meta.url)` asset references so Turbopack
emits them into `.next/server/assets` and includes those destinations in every social-card
server trace. Do not replace them with a cwd-based `node_modules/geist` path: tracing can retain
the font bytes under pnpm's storage path while omitting the alias the renderer tries to open.
Prerendered images can then work while crawler-triggered runtime rendering fails on Vercel.

`e2e/social-cards.api.spec.ts` checks every public page's card and the app link previews; add a new
public page to its `publicPaths` (and to `e2e/seo.api.spec.ts`). It requests the advertised card URL,
including its version query, as Googlebot, and checks all social-card traces for the exact runtime
font assets, comparing their bytes with the pinned package TTFs. Hosted acceptance must also
request the advertised images as a crawler: a local
`next start` retains the full node_modules tree and cannot expose every packaging omission.
