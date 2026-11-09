# Accessibility and SEO panels

Two panels report on the page under review, opened from the pill like the inbox
([uier #174](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_C_nKFJTsza8hv7_NCXjTq)).
Every issue they find has a quick action that posts it as a comment in one click.

## Where they open

- **Accessibility** and **SEO** are buttons in the pill after Inbox, from 640 px wide (where panels dock
  beside the page). Narrower, the pill keeps its width and both are the first rows of Options; closing a
  panel gives the focus back to the button that opened it (Options there).
- Each panel is a `DockablePanel` (`uier-panel-accessibility`, `uier-panel-seo`): ink, docked on its own
  side, Close has the focus when it opens, Escape closes it. The inbox and the checks panels share the
  dock, so one of them is open at a time (`CommentsGlobal`: opening the inbox or Reattach closes a
  checks panel). Their buttons name the open panel in `aria-controls`, and on uier's own pages both
  panels are reviewable parts (`toolbarParts.ts`, "accessibility panel", "SEO panel").
- `components/checks/PageChecks.tsx` owns what the panels keep while closed: the last report of each,
  the comments their quick actions posted (by issue key; keys end with the checked page's path, so after a
  client-side navigation the same finding on another page can be commented again) and the highlighted element. Opening a panel
  checks the page when it has no report of the current page; **Check again** runs it again. A report of
  another page (after a client-side navigation) says so.

## Layout

Both panels share one layout (`components/checks/ChecksParts.tsx`), so they read the same way
([uier #197](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_Z9xMVmu-Ai2HN7Hm-ryXZ)):

- **The summary first** (`ChecksSummary`): a tile for each kind of result with its count, its icon in
  the result's colour only while it counts something (muted at 0), then one line with when it was checked.
- **Sections** (`CheckSection`): a heading with its count and a short note on the right, over one
  bordered card whose rows are divided by lines.
- **Rows** (`CheckItem`): one compact row per check: the state icon, the name, a short measurement on
  the right (`measure`, Core Web Vitals), what was found on its own line (`value`), then a one-line reason.
- **Issues** (`IssueList`): one muted row per element, its short name with Highlight and Comment on the
  right. A line every issue of a list shares is said once (by the check's reason, or under the rule's
  title), not on every element (`sharedSummary`); a single SEO issue's detail is in its check's reason.

## Accessibility

- axe-core (`axe-core`, MPL-2.0, its notice kept in the file) is **not** in the review bundle. It is the
  separate asset `dist/audit.js` (`src/checks/auditEntry.ts`), published like the review script at
  `/toolbar/<sha256>.js` and pinned in the review script by path and SHA-384 SRI (`tsup.config.ts`
  fills in `__UIER_AUDIT_PATH__` / `__UIER_AUDIT_INTEGRITY__` from its final bytes, before the review
  script's own hash). `src/checks/axeLoader.ts` adds it as a classic script, once, only when the panel
  runs a check, with the review script's nonce and referrer policy and anonymous CORS, resolved against
  the review script's URL. A site whose CSP allows the toolbar allows it too; axe-core needs no `eval`
  with its default locale. The development build loads `./audit.js` (`next dev` rewrites `/audit.js`).
- The asset hands axe-core over through a symbol on its own script element (`auditHandoff.ts`), never a
  page global: `auditPrelude.ts` saves the page's `axe` and `define` before axe-core initializes, hides
  an AMD `define`, and puts both back.
- `src/checks/accessibility.ts` runs every rule axe-core runs by default (WCAG A and AA, best practices)
  on the document, excluding the toolbar's host and inline thread slots by reference, without frames
  (`iframes: false`). One audit runs at a time. Results are grouped by impact (critical, serious, moderate,
  minor), each rule with its help text, id and **How to fix** link (Deque University, without its tracking
  query), and each element with axe-core's first failure line and its short name (`img#hero.logo`).
- Packaged clients (the browser extension) never inject a remote script: there the Accessibility button
  is absent (`auditAvailable()`), and the SEO panel works as everywhere.

## SEO

`src/checks/seo.ts` reads the page's own document when the panel opens (the toolbar's shadow root and
inline threads are never in `document.querySelectorAll`). Each check is pass, warning or a note (not
measured, not needed), with a one-line reason. The summary counts what is worth a look (warnings,
amber) and what passed (green); notes are not counted. The heading outline is folded under the heading
checks (a `details` row, "Outline").

- **Page**: indexing, the title (10 to 60 characters), the meta description (one, 50 to 160 characters)
  and the canonical link (one, valid, pointing to this page's origin and path). Indexing reads the
  `robots` and `googlebot` meta tags: `noindex` (or `none`) is a note that the page asks search engines
  (or Google) not to index it, and on such a page a missing canonical link is a note, "Not needed",
  not a warning ([uier #195](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_1hEpNjurDgh70vdAEO8Tn)).
  The uier app's pages declare `noindex` on purpose ([search indexing](../../../apps/web/docs/search-indexing.md)).
  A canonical that is there is still checked. The `X-Robots-Tag` response header is not in the document
  and is not read.
- **Headings**: one h1, no skipped levels (an h3 right after an h1), no empty headings, and the outline.
- **Links**: the count (this site and other sites), links without text (text, `aria-label`,
  `aria-labelledby`, `title` or an image's alt text), and addresses that look broken: empty, `#` alone,
  `javascript:`, not valid, containing `undefined`/`null`/`NaN`, `http` on an `https` page, or a `#id` on
  this page that is not there (hash routes and `#top` excepted).
- **Images**: `img` elements without `alt`, unless marked as decoration (`role="presentation"`/`none`,
  inside `aria-hidden="true"`).
- **Core Web Vitals** (`src/checks/webVitals.ts`), measured in this browser with the Performance Timeline
  and updated while the panel is open: LCP (buffered `largest-contentful-paint`, from a prerender's
  activation), CLS (the largest session window of `layout-shift` entries without recent input) and INP
  (`event` entries from 16 ms, the longest per interaction, one left out per 50 interactions). Measuring
  starts with the review layer (`startWebVitals` in `PageChecks`), and buffered entries reach back to the
  page's load. The toolbar is left out: candidates and shift sources in it, and its own interactions,
  known by their target or by their events' time stamps (a press that removes its button reports no
  target). Targets: 2.5 s, 0.1 and 200 ms; a browser without an entry type says "Not measured in this
  browser", and INP without slow interactions passes as "Every interaction so far took under 104 ms".

## Quick actions

- **Highlight** (an issue with an element) scrolls the element into view and outlines it
  (`ElementHighlight`: the point-mode outline with the selection tint, in the shadow root, so screenshots
  and the audit leave it out). One element at a time; a hidden element is announced as not visible.
- **Comment** posts the issue at once through the new-comment create (`useIssueComment`): the optimistic
  pin, the automatic screenshot and the browser's details, like a comment from the form. An issue with an
  element is pinned to its middle (an element in the page's own shadow root goes to its outermost host;
  one in a closed menu gets its opener as `layer`), scrolled into view first for the screenshot. One about
  the page is the project's page feedback, a bug report where that type is on (else feedback, else the
  first enabled type), and pinned to the main content when every page feedback type is off. The text is
  the issue's short description (`Accessibility (critical): ... Rule image-alt: <link>`, `SEO: ...`,
  `Core Web Vitals: ...`). The row then says "Comment posted as #12" (or "Bug report sent") with **Show**:
  the thread on its pin, or the inbox narrowed to it for page feedback. A failed post shows the usual
  toast and the action comes back.
- A project's guest without a saved name gets the comment form's name field above the issues; a quick
  action asks for it first and saves it like the form does.

## Bundle and loading

The panels' code is in the review bundle (about 32 KB minified, no new dependency there); axe-core
(about 680 KB) loads only from the Accessibility panel. Nothing here runs for ordinary visitors: the
review bundle itself loads only for reviewers.

## Tests

`apps/web/e2e/page-checks.spec.ts` on a project's site on another origin with the install guide's CSP
(`?page-checks` in `e2e/support/reviewedSite.ts`): no audit request before the Accessibility panel opens
and one after, rules by impact without the toolbar, Highlight, a comment posted on the element with its
screenshot and details, Show, focus back on Close (Desktop Chrome); the SEO checks, the summary's counts,
the folded outline, Core Web Vitals not counting the toolbar's presses, a guest's name, page feedback, an
element's comment and a noindex page (its Indexing note, no canonical needed) (Desktop Chrome);
the panels from Options on a phone, fitting the screen (Mobile Chrome). `toolbar-assets.api.spec.ts`:
the audit asset is pinned by path and SRI in the review script, absent from the loader and the review
script, and served with CORS and immutable caching.
