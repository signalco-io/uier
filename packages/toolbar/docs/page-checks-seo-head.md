# SEO panel: Sharing and Structured data

Two sections of the SEO panel, Sharing in its Sharing tab and Structured data in its Search tab (after Crawlers), on the sections framework of
[page checks](page-checks.md#sections). The logic is in the audit asset (`src/checks/lazy/sharing.ts`,
`structuredData.ts`), the views in `components/checks/sections/SharingSection.tsx` and
`StructuredDataSection.tsx`. Check ids start with `share-` and `schema-` (type `seo`).

## Sharing

How the page looks when its link is shared or shown in search results.

- **Two definitions.** `sharing` reads the tags (`when: 'background'`: a few
  `querySelectorAll` calls, no request). `sharing-image` loads the shared image (`when: 'panel'`: a request).
  The view puts the image's row (**Image size**) right after the image's tag row, says "Loading the
  image..." meanwhile, and renders both previews as the section's own rows.
- **Tags.** Open Graph (`og:title`, `og:description`, `og:image` with `:secure_url`, `:width`, `:height`,
  `:alt`, `og:url`, `og:type`, `og:site_name`) and X (`twitter:card`, `twitter:title`, `twitter:description`,
  `twitter:image`), read from `property` or `name`. Empty tags count as missing.
- **Rows.** Shared title and description (from the tag; without it the page title or meta description is
  the fallback, a note; tags with different text are a warning, the same text twice a note). Shared image (none on an indexable page, or only
  `twitter:image`, is a warning; a relative or non-http address is a warning; `og:image:secure_url` is used
  for an `http` `og:image`). `og:url` (no different ones, a full address, the same page as the canonical link, else as this
  page; origin and path, a trailing slash ignored, like the Page section). X card (`summary`,
  `summary_large_image`, `app`, `player`; another value is a warning; none is a note, which repeats only what
  X's markup page documents: a summary card may show from `og:type`, `og:title` and `og:description`).
- **noindex.** On a page whose `robots`/`googlebot` meta asks not to be indexed, missing tags are notes.
  Duplicates, a mismatched `og:url` and a broken address are still warnings.
- **The image** is loaded with an `Image` object (no referrer, `decoding="async"`, never added to the page),
  with a 10 s timeout, cancelled with the section (`SectionContext.signal`). Its real size is compared with
  Facebook's sharing guide: under 200 × 200 px is a warning; under 1200 × 630 px, a shape more than 15 %
  from 1.91:1, or `og:image:width`/`height` that differ from the file are notes with the numbers. An image
  that does not load is a warning; one the page's CSP blocks (a `securitypolicyviolation` for `img-src`
  with its address, which can arrive just after the `error`) is a note, "Not checked"; a timeout is a note.
- **Previews** (`data-uier-preview="search"` and `"card"`): neutral cards in the toolbar's tokens, captioned
  "About how a search result looks" and "About how a shared link looks". The snippet shows the site
  (`og:site_name`, else the host), the address, the page title cut to 60 characters and two lines of the
  meta description. The card shows the image (`og:image`, else `twitter:image`), the host, the title and
  description (Open Graph, else the page's). The image is an `<img>` in the shadow root with
  `referrerpolicy="no-referrer"`, `loading="lazy"` and an empty `alt`; when the site's CSP or the network
  blocks it, the card says "Image not shown here". They imitate no platform's interface, logo or colours.

## Structured data

- **JSON-LD.** Every `script[type="application/ld+json"]` outside the toolbar, in the `background`, bounded:
  at most 20 blocks, 100,000 characters each and 250,000 in all (larger ones are skipped and said), 500 items,
  16 levels deep. `@graph` is flattened; an item is an object with `@type` (a string or an array;
  `https://schema.org/` and `schema:` prefixes dropped); nested items know their parent's type.
- **Rows.** Found (the top items' count and types; no structured data is a note, "Not every page needs
  it"); Parse errors (one issue per block that is not JSON, with the parser's message); Vocabulary (only
  when a block has no schema.org `@context`); one row per common type; Microdata and RDFa (`[itemscope]`
  items and `[typeof]` elements, with their types: counted, not checked).
- **The table** (`expectations` in `structuredData.ts`) holds, per type, the properties Google's
  documentation for the feature lists, each entry linking its page (checked November 2026): Product
  (`name`, one of `offers`/`review`/`aggregateRating`), Offer under a Product (`price` or
  `priceSpecification`), BreadcrumbList (`itemListElement`), Event (`name`, `startDate`, `location`), Recipe
  (`name`, `image`), VideoObject (`name`, `thumbnailUrl`, `uploadDate`), LocalBusiness (`name`, `address`),
  WebSite (`name`, `url`, Google's site names). Missing is a warning, worded by its source ("Google's product
  snippet documentation requires one of them"). Article, NewsArticle and BlogPosting have no required
  properties in Google's documentation: its recommended `headline`, `image`, `datePublished` and `author`
  are a note. Other types (Organization, Person, FAQPage, which Google no longer shows as a result) are
  listed, not judged; schema.org itself requires nothing.
- **Issues** are about the page (JSON-LD is not rendered): the comment names the block by its position, the
  type, its name, what is missing (or the parse error) and the documentation's address, never the block.
  Each block or item has its own check id (`schema-parse-2`, `schema-product-3-1`), so marking one as
  reported does not mark the others.

## Tests

`apps/web/e2e/page-checks-seo-head.spec.ts` (Desktop Chrome) on `fixture-seo-head`
(`e2e/support/fixtures/seoHead.ts`, which serves real 1200 × 630 and 120 × 120 PNGs and a 404):
`/complete` (every row passing, the measured 1200 × 630, both previews and the card's image attributes, a
`@graph`, axe on the panel); `/broken` (the tag warnings before the panel opens, the image that did not
load and the card's fallback, a parse error, an Article note, a Product warning posted as a comment with
its check id, microdata counted, the summary and button counts, axe); `/small`, `/blocked` (CSP) and
`/noindex`.
