# SEO panel: more Page, Links and Images checks

More checks in the SEO panel's own sections ([Accessibility and SEO panels](page-checks.md#seo)): the
viewport, the language and the hreflang tags under **Page**, generic link text and **Check links**
under **Links**, and how the images are sized, loaded and weighed under **Images**. They have no card of
their own: their rows are among the panel's, and the summary and the SEO button count them.

## Where they run

- **In the review bundle** (`src/checks/seo.ts`, with the panel's report, also in the packaged
  extension): the viewport, the language and generic link text, a few lines each.
- **In the audit asset** (`src/checks/lazy/pageExtras.ts`, [sections](page-checks.md#sections)), shown by
  `components/checks/sections/pageExtras.tsx` in `SeoPanel`'s sections with `useSection(...)`:
  - `seo-hreflang` (`background`): one `querySelectorAll` for the hreflang tags, no requests.
  - `seo-images` (`panel`): reads every rendered image's box and computed style, so it runs when the
    panel opens, never unasked.
  - `seo-link-status` (`manual`): only when **Check links** is pressed.

  The SEO button counts their warnings once they ran (images: once the panel opened). Without the audit
  asset (the packaged extension) they show nothing, and Check links is not offered.
- The largest contentful element is known to the review bundle (`largestPaintElement()` in
  `webVitals.ts`); the images section's `run` passes it in, since the audit asset has its own copy of
  every module.

## Page

- **Viewport** (`viewport`): the last `meta[name=viewport]` has `width=device-width`. Without it, a
  warning: phones show the page zoomed out. Zoom blocking (`user-scalable=no`, `maximum-scale`) is the
  Accessibility panel's (axe-core's `meta-viewport`).
- **Language** (`lang`): `html[lang]` is there. Missing, a note with a comment action (screen readers and
  translation tools guess the language). Whether the value is valid is the Accessibility panel's.
- **Language versions** (`hreflang`), only on a page with `link[rel=alternate][hreflang]`. Each kind of
  problem is one issue about the page that names its tags (`hreflang="de" href="/de/plans"`), with its own
  check id, so each is reported once:
  - `hreflang-value`: a value that is not a language, optionally with a script and a region (`en`,
    `zh-Hant-TW`, `es-419`), or `x-default`; `en_US` and a `UK` region (it is `GB`) are not.
  - `hreflang-address`: not a full `http(s)://` address.
  - `hreflang-duplicate`: more than one tag with the same value (case-insensitive).
  - `hreflang-self`: none points to this page (origin and path, a trailing slash ignored).
  - `hreflang-canonical`: with one canonical link to another page, none points to that address (with its
    query). The tags then need not name this page.

## Links

- **Generic link text** (`link-generic`): links whose whole text (lowercase, without trailing punctuation
  or arrows) is a phrase that says nothing out of context: "click here", "here", "read more", "learn
  more", "more", "this", "link", "details", "continue" and the like (`genericPhrases` in `seo.ts`). A
  warning with an issue on each link; the reason says the text when they share it. A link with its own
  `aria-label` or `aria-labelledby` that is not generic is left out. **The list is English**: on a page
  whose `html[lang]` is another language it is a note, "Not checked"; on a page without `lang` it applies.
- **Check links** (`link-status`): a control at the end of the Links section, with its progress in a
  `role="status"` ("Checked 37 of 100") and one button that is Check links, Stop while it runs, then
  Check links again (the focus stays on it). It never runs unasked; the panel's Check again drops its
  results.
  - What it requests: the page's `a[href]` and `area[href]` to its own origin, `http(s)` only, without
    their hash, each address once, in the page's order, **at most 100** ("Checked the first 100 of 240
    addresses on this site"), four at a time, 10 s each, with the reviewer's session (`credentials:
    'same-origin'`, `mode: 'same-origin'`), `cache: 'no-store'`, without following redirects
    (`redirect: 'manual'`). `HEAD` first, then `GET` when the server refuses `HEAD` (405, 501) or answers
    it with an error (some servers answer `HEAD` differently); a `GET`'s body is cancelled at once.
  - **Never requested**: addresses whose path or query looks like an action (`logout`, `sign-out`,
    `delete`, `remove`, `unsubscribe`, `cancel`, `add-to-cart`, `confirm`, `verify`, `token`, `nonce` and
    the like: `actionAddress`), links with `download`, links a script sends with another method
    (`data-method`, `data-turbo-method`), other sites, and anything that is not `http(s)`. The **Not
    requested** note says how many of each.
  - Results: 404, 410 and 5xx are a warning with an issue on every link to that address ("Answers 404");
    401 and 403 a note, **Needs a sign-in**; redirects a note, **Redirects**; timeouts and failed
    requests a note, **No answer**. The row's value says how many were checked, or where it stopped.
  - **Stop** (and `context.signal`: leaving the page, Check again) aborts the requests on their way. Stop
    keeps what was found ("Stopped after 37 of 100"); the progress and Stop live beside the sections'
    store in `pageExtras.tsx`, which knows only "checking".
  - A site's CSP whose `connect-src` leaves out its own origin blocks every request: after the first
    failure and its `securitypolicyviolation` event, the rest is not requested and the row is one note.

## Images

For rendered `img` elements of the page, each read once (`getBoundingClientRect`, `getComputedStyle`):

- **Image dimensions** (`image-dimensions`): no `width` and `height` attributes, a computed
  `aspect-ratio` of `auto`, in the page's flow (not `absolute` or `fixed`), and, once loaded, shown at the
  file's own proportions (else CSS sets both sides). A warning: it can shift the page while it loads.
- **Image size** (`image-size`): the file is more than twice as large as shown, times the screen's pixel
  ratio, in both directions, and has at least 250,000 more pixels: "2400 × 1600 shown at 300 × 200". A
  `srcset` candidate's `w` or `x` descriptor gives back the file's own pixels (`naturalWidth` is
  density-corrected). SVG files are left out.
- **Lazy loading** (`image-loading`): `loading="lazy"` on the largest contentful element or on an image in
  the first window (the top of the page, one window high) is a warning: it delays what the visitor sees
  first. **Images far below** (`image-offscreen`): a note for images shown at 200 × 200 or more, from two
  windows down, without it.
- **Image weight** (`image-weight`): files over 500 KB (`encodedBodySize` of the image's
  `PerformanceResourceTiming`), each file once. The browser reports it for the site's own images and for
  other sites' sent with `Timing-Allow-Origin`; without any, a note. Nothing is said about formats.

## Tests

`apps/web/e2e/page-checks-seo-page.spec.ts` (Desktop Chrome) on `site.origin('fixture-seo-page')`
(`e2e/support/fixtures/seoPage.ts`: PNG files of known dimensions and weight, hreflang sets, generic links,
links that answer 404, 500, 403, 405 for `HEAD`, a redirect, and a `/logout` and a `download` link whose
requests it counts): every row and its issues, the summary's count, a 404's comment and check, axe-core on
the open panel, nothing requested before Check links or after Check again, each address once with `HEAD`
then `GET`, never `/logout`; 120 links: Stop keeps what was found and sends nothing more, then the first
100 only, at most four at a time; a page without a viewport or `lang`, a page in German, a valid and a
canonical hreflang set, and a CSP that blocks Check links (one note, nothing requested).
