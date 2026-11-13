# Search indexing

[The public page inventory](../../../docs/public-page-inventory.md) records each canonical route's
intent, priority, maintained source, review date, owner and outstanding gate, plus planned pages
that must stay out of discovery. Follow its registration and maintenance procedure for every new
page. KnownPages and the existing catalogs remain the code registrations; the inventory adds their
editorial ownership rather than another routing or crawl-file system.

The public `/guides` index links client review, Next.js and browser extension setup, plus the human
website-review checklist and copyable bug-report template
([guides](guides.md)). Use the existing `ContentPage` and guide components, snippet generator,
metadata and social-card helpers; add public routes to SEO, card and footer checks. `SiteStructuredData` connects the homepage `WebSite` to its actual
signalco publisher. Preserve the homepage Bing verification meta tag after setup.
`search-index.mjs` generates the public static-page manifest in the uncached web `build` task,
after the cacheable `build:compile` task produces the sitemap and HTML. It records the current
commit even on a compilation cache hit. Toolbar archive retention also runs in finalization;
neither step is restored from a task cache. See [build caching](../../../docs/development.md#build-caching).
The production workflow skips the IndexNow job when those content hashes have not changed; otherwise it submits
only added, changed and removed public URLs. See
[search discovery](../../../docs/search-discovery.md) for safeguards and recovery.

`/compare` is linked from the marketing navigation, footer and landing page. Its website-feedback
matrix and tool comparisons are public static pages, included in the sitemap, IndexNow manifest,
canonical and social-card checks. Contextual links from the client review guide, feedback triage
and integrations connect the comparisons to the workflows they describe. The client review guide
links the Pastel comparison for reviews that include files as well as a live website.

Public pages use `publicPageMetadata` (`src/lib/metadata.ts`) with their own pathname, title and
description. Canonicals and Open Graph URLs point to the production URL without query parameters;
never put a homepage canonical in the root layout, where other pages would inherit it.
`next-sitemap.config.cjs` excludes app flows, notification preferences, empty verification bridges
and metadata assets. Add public pages outside the prerender inventory through `additionalPaths` (currently `/status`).
The status shell now prerenders, but `search-index.mjs` still excludes live health from IndexNow
content submissions.
Do not emit build times as `lastmod`; use real content modification dates if they become available.

App pages, notification preferences and verification/session bridges declare `noindex`. Keep them
crawlable in `robots.txt` so search engines can read that directive; authentication protects app
data. `e2e/seo.api.spec.ts` checks generated HTML, the sitemap and these crawl directives. See
[search indexing](../../../docs/development.md#search-indexing) for checks and Search Console context.
