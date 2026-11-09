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
  client-side navigation the same finding on another page can be commented again) and the highlighted element. Both
  check the page in the background ([below](#in-the-background)), so a panel opens with its report. Opening a panel
  checks the page when it has no report of the current page (and none is running); **Check again** runs it again. A report of
  another page (after a client-side navigation) says so.

## In the background

Both checks run once the toolbar has loaded, without waiting for a panel and without getting in the
person's way
([uier #208](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_HGmaIZ3KHhrhjlIFnduAq)).

- When: once per page (`PageChecks` remounts for every page, so again after a client-side navigation),
  after the page's `load` event (at most 10 s), once it has stopped rendering (`pageSettled`) and when the
  browser is idle (`requestIdleCallback`, at most 5 s; a short timeout where it is missing), all in
  `src/checks/pageIdle.ts`. axe-core resolves every rule in a task of its own, so the audit yields to the
  page between rules; `launch-performance.spec.ts` keeps its long tasks under its budget.
- Only where the toolbar can show the result: not while it is collapsed (expanding it starts the
  checks), and the audit only where the Accessibility button is (`auditAvailable()`). Where the browser
  asks to save data (`Save-Data`), the audit is not downloaded unasked; the panel still runs it.
- A check a panel asked for meanwhile is not run twice (`auditedPath`, `seoPath`), and an open panel shows
  "Checking this page..." until the background audit ends. A failed background audit is quiet (opening the
  panel tries again, and says so if it fails then), unless the panel is open by then. It never clears a highlight.
- **The indicator.** While a report of this page found something to act on, its button in the pill gets
  a small amber dot (`AttentionDot`, `--brand-warning`, `data-uier-attention`) and an accessible name that
  says what (`checksButtonLabel`): "Accessibility, 3 issues found" (every element of every rule) and "SEO,
  2 to look at" (the panel's "To look at" count, Core Web Vitals included, so it follows them as the page
  is used; `ChecksAttentionReporter`). The tooltip stays the panel's name. On a narrow screen the dot and
  the name are on the panel's Options row. Without a report, or with nothing to act on, neither changes.

## Layout

Both panels share one layout (`components/checks/ChecksParts.tsx`), so they read the same way
([uier #197](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_Z9xMVmu-Ai2HN7Hm-ryXZ)):

- **The title row** (`ChecksPanel`): the handle and the title, then two icon buttons, Check again and
  Close, each with its name as the accessible name and tooltip
  ([uier #206](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_AwJBAvg6X-mTNMYh8MVJA)).
  Check again is never disabled and is `aria-busy` while a check runs.

- **The summary first** (`ChecksSummary`): a tile for each kind of result with its count, its icon in
  the result's colour only while it counts something (muted at 0), then one line with when it was checked.
- **Sections** (`CheckSection`): a heading with its count and a short note on the right, over one
  bordered card whose rows are divided by lines.
- **Rows** (`CheckItem`): one compact row per check: the state icon, the name, a short measurement on
  the right (`measure`, Core Web Vitals), what was found on its own line (`value`), then a one-line reason.
- **Issues** (`IssueList`): one muted row per element, its short name with Highlight and Comment on the
  right. A line every issue of a list shares is said once (by the check's reason, or under the rule's
  title), not on every element (`sharedSummary`); a single SEO issue's detail is in its check's reason.
  So an SEO check whose count alone doesn't say why (link addresses, heading levels) adds the shared line
  to its reason ("2 links look broken. It runs a script instead of opening a page.").

## Across pages

An open inbox, Accessibility or SEO panel stays open on the next page and shows that page
([uier #196](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_5qyBH-wrDYC5Vim0dgff-)).

- `CommentsGlobal` remounts for every page (keyed by the path), so `src/openPanel.ts` keeps the open
  panel in module memory for client-side navigation and in `sessionStorage` (`uier:toolbar-panel`) for
  a full page load. A full load restores it only when it continues the tab on the site (a same-origin
  referrer with history before it, back or forward, a reload); a page opened anew, such as from a
  review link, starts without one. So does a window opened from the site: it gets a copy of the
  opener's `sessionStorage` and its referrer, but no history of its own (`history.length` 1). Exit
  review forgets it; `feedback` mode and an Accessibility panel without its audit never restore.
- The inbox keeps its filter (status, pages, search) across client-side navigation only, in memory: its
  search is never written to the site's storage. "This page" then lists the new page, and a page chosen
  in the picker that the inbox then reaches is "This page" too (`useInboxComments`), with its comments.
- A restored panel (`RestoredPanelContext`) neither slides in nor takes the focus, so a link click
  leaves the focus on the page; the showcase hint stays closed. Opening a panel again behaves as usual.
- A restored checks panel checks the new page once it has rendered (`src/checks/pageSettled.ts`: no
  added, removed or edited nodes for 300 ms, at most 3 s), since a client-side router can change the
  address before the page. The Accessibility panel shows "Checking this page..." meanwhile; Check again
  checks at once. An audit still running from the previous page is not reused: the new one waits for
  it and checks this page.

## Accessibility

- axe-core (`axe-core`, MPL-2.0, its notice kept in the file) is **not** in the review bundle. It is the
  separate asset `dist/audit.js` (`src/checks/auditEntry.ts`), published like the review script at
  `/toolbar/<sha256>.js` and pinned in the review script by path and SHA-384 SRI (`tsup.config.ts`
  fills in `__UIER_AUDIT_PATH__` / `__UIER_AUDIT_INTEGRITY__` from its final bytes, before the review
  script's own hash). `src/checks/axeLoader.ts` adds it as a classic script, once, only when the panel
  runs a check (in the background or from the panel), with the review script's nonce and referrer policy and anonymous CORS, resolved against
  the review script's URL. A site whose CSP allows the toolbar allows it too; axe-core needs no `eval`
  with its default locale. The development build loads `./audit.js` (`next dev` rewrites `/audit.js`).
- The asset hands axe-core over through a symbol on its own script element (`auditHandoff.ts`), never a
  page global: `auditPrelude.ts` saves the page's `axe` and `define` before axe-core initializes, hides
  an AMD `define`, and puts both back.
- `src/checks/accessibility.ts` runs every rule axe-core runs by default (WCAG A and AA, best practices)
  on the document, excluding the toolbar's host and inline thread slots by reference, without frames
  (`iframes: false`). One audit runs at a time: one asked for while another runs waits for it, then
  checks the page as it is then (never sharing the running one's report), and the panel shows only its
  latest audit. The panel lists only what axe-core finds
  ([uier #198](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_fCCTyY6zuzO3K_Kr-DALq)):
  the status ("3 issues found."), a summary tile per impact with its elements' count, when it was checked,
  then a section per impact (critical, serious, moderate, minor). Each rule is a row marked with its
  impact's icon in its colour (`impactStyles`: the priority colours, a shape each, see `BRAND.md`,
  "Accessibility impact"), its help text, id, the standard it tests (`ruleStandard`, from axe-core's tags: "WCAG 1.4.3 (AA)",
  or "Best practice") and **How to fix** link (Deque University, without its tracking query); each element is a row with its short name (`img#hero.logo`). axe-core's first failure
  line is said once under the rule's title when every element shares it, else on each element, two lines
  at most (the whole line is its `title`, and screen readers read all of it). Without issues the panel
  says so in one line, with a reminder to also try a keyboard and a screen reader.
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

- **Highlight** (an issue with an element; an icon button named in its tooltip, so the row keeps one line) scrolls the element into view and outlines it
  (`ElementHighlight`: the point-mode outline with the selection tint, in the shadow root, so screenshots
  and the audit leave it out). One element at a time; a hidden element is announced as not visible.
- **Comment** posts the issue at once through the new-comment create (`useIssueComment`): the optimistic
  pin, the automatic screenshot and the browser's details, like a comment from the form. An issue with an
  element is pinned to its middle (an element in the page's own shadow root goes to its outermost host;
  one in a closed menu gets its opener as `layer`), scrolled into view first for the screenshot. One about
  the page is the project's page feedback, a bug report where that type is on (else feedback, else the
  first enabled type), and pinned to the main content when every page feedback type is off. The text says
  what was found and where, so whoever fixes it needs nothing from the panel:
  - Accessibility: `Accessibility (critical): <help>.`, `Element:` with axe-core's selector, axe-core's
    failure lines for that element as a list under its "Fix any of the following:" headings (the measured
    contrast ratio, the missing attribute), then `WCAG 1.1.1 (A). Rule image-alt: <link>`. Failure lines
    that would pass the API's 1000 characters are left out (`commentText`); the rule's page has them all.
  - SEO: the sentence, then what was found on a line of its own: the title or description, a heading's
    text, a link's text and address, an image's address (`foundLine`). Core Web Vitals name the element.
  - Text from the page is a code span, so it is never read as Markdown. Addresses are written without
    their query, which can hold a token, and a `data:` address as its type alone (`writtenAddress`).
- The request also names the check, `check: { type, id }` (`accessibility` with the rule id, `seo` with
  the check id, `web-vitals` with `lcp`, `cls` or `inp`; [the API](../../../docs/api.md#comments-api)). The API
  saves it and returns it with the comment (`CommentItem.check`), in the feedback packet and through MCP.
- **Already reported.** A finding keeps its comment after a reload and for every other reviewer
  (`checks/reportedIssue.ts`): among the page's threads, an open one posted from the same check on the same
  element (its anchor resolves to the issue's element), or about the page for an issue without an element.
  Its row says "Reported as #12" with **Show** and has no Comment action, so the same finding is not
  reported twice. What this panel posted itself keeps its own words ("Comment posted", "Bug report sent").
  A thread marked as done no longer counts: a finding still on the page can be reported again. Several
  elements of a page's own shadow root share their host's anchor, so one comment marks them all. A report
  of another page (`PageIssue.path`) is never matched against this page's threads.
- After posting, the row says "Comment posted as #12" (or "Bug report sent") with **Show**:
  the thread on its pin, or the inbox narrowed to it for page feedback. A failed post shows the usual
  toast and the action comes back.
- A project's guest without a saved name gets the comment form's name field above the issues; a quick
  action asks for it first and saves it like the form does.

## Bundle and loading

The panels' code is in the review bundle (about 32 KB minified, no new dependency there); axe-core
(about 680 KB) is still its own asset, loaded on use: by the background audit once the page is idle, or
by the panel. Nothing here runs for ordinary visitors of a project's site: the review bundle itself loads
only for reviewers. uier.io's own public pages show the toolbar to everyone (`showcase` mode), so there the
background checks run for every visitor whose browser does not ask to save data.

## Tests

`apps/web/e2e/page-checks.spec.ts` on a project's site on another origin with the install guide's CSP
(`?page-checks` in `e2e/support/reviewedSite.ts`): one audit request in the background, the buttons' dots
and names before a panel opens, the panel opening with that report and no new request, rules by impact without the toolbar, Highlight, a comment posted on the element with its
screenshot, details, failure lines, standard and check, Show, focus back on Close, the impact tiles' counts and a rule's shared line said once (Desktop Chrome); the SEO checks, the summary's counts,
the folded outline, Core Web Vitals not counting the toolbar's presses, a guest's name, page feedback, an
element's comment with what was found and its check, findings marked as reported after a reload (with Show) until their thread is done, a noindex page (its Indexing note, no canonical needed) and broken links sharing one reason (Desktop Chrome);
the panels from Options on a phone, their rows marked by the background checks, fitting the screen (Mobile Chrome); the SEO panel and the inbox
staying open across a client-side navigation, a same-site full load and a reload, and not on a page
opened anew; an Accessibility panel left open while the previous page's audit still runs (a slow
axe-core) showing the new page's report, a window opened from the site starting without the panel, and
the inbox showing another page listing its comments once it reaches that page (Desktop Chrome).
`comments.api.spec.ts`: a comment keeps its `check`, the packet names it, and other values are refused.
`toolbar-assets.api.spec.ts`:
the audit asset is pinned by path and SRI in the review script, absent from the loader and the review
script, and served with CORS and immutable caching.
