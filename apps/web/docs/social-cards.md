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

`e2e/social-cards.api.spec.ts` checks every public page's card and the app link previews; add a new
public page to its `publicPaths` (and to `e2e/seo.api.spec.ts`).
