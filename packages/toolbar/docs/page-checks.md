# Page-check panels

Accessibility, SEO and [Security and compliance](page-checks-security.md) report on the page under review, opened from the pill like the inbox
([uier #174](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_C_nKFJTsza8hv7_NCXjTq)).
Every issue they find has a quick action that posts it as a comment in one click.

## Where they open

Project admins can hide optional toolbar tools in Review settings → Toolbar features, with a separate
signed-out selection on projects allowing guests ([settings](../../../apps/web/docs/project-settings.md#toolbar-features)).
`ProjectGate` supplies the review API's effective `toolbarFeatures` list. Missing fields (older servers
and the standalone showcase) keep all tools. A hidden panel has no desktop button or mobile Options
row, cannot be opened through a restored panel or handler, and does no background work: no audit,
sections or Web Vitals for that hidden tool. With every check tool hidden, no checks panel mounts. SEO summaries
do not wait for an Accessibility audit when that tool is hidden. Refreshing the configuration removes
disabled panels and cancels their work; the inbox and all existing feedback remain available.
Text rewrites use the same feature list on the selection toolbar and saved draft entry points.
`toolbar-features.spec.ts` covers desktop/mobile controls, restored panels, guests leaving feedback with
all optional tools hidden, and the absent audit download.

- **Page checks** is one button in the pill after Inbox, from 640 px wide (where panels dock beside the page;
  `PageChecksMenu`, [uier #353](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_0Di6IvUzeVGM_svuu5xmT)),
  so the pill does not grow with every tool. Its icon is Lucide's monitor-activity (`PageChecksIcon`). It opens a menu (`role="dialog"` "Page checks", a reviewable part,
  "page checks menu") of **Accessibility**, **SEO** and **Security and compliance**, the ones this review shows: each item
  has the tool's icon, its amber dot, the name with its count ("SEO, 2 to look at"), `aria-expanded` and
  `aria-controls`, as the separate buttons had. Choosing one opens its panel (its Close takes the focus) or closes it;
  ↑ ↓ move between items and Escape closes only the menu. With a single tool on, that tool keeps its own button.
  Narrower than 640 px, the pill keeps its width and the tools are the first rows of Options; closing a
  panel gives the focus back to the button that opened it (Page checks, or Options there). Deep links and restored
  panels open the panel directly; there are no keyboard shortcuts for the tools.
- Each panel is a `DockablePanel` (`uier-panel-accessibility`, `uier-panel-seo`, `uier-panel-consent`): ink, docked on its own
  side, Close has the focus when it opens (never Check again beside it; both are small icon buttons, the handle's size,
  [uier #297](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_sHphgXGmcH-cClEsQH-Rs)), Escape closes it. On uier's own pages the panels are
  reviewable parts (`toolbarParts.ts`, "accessibility panel", "SEO panel", "security and compliance panel").
- **Two at once** ([uier #247](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_0noiz5-nVbRxXdaqpC2sH)): the inbox and the checks panels share the dock, one panel
  on each side. `CommentsGlobal` keeps the open panels oldest first (`openPanels`) and `fitPanels`
  (`src/openPanel.ts`) keeps what fits: opening a panel closes only an open one on its side, so two
  panels docked on different sides stay open together. Moving a panel onto the side of another open one
  swaps their sides (`DockablePanel`, both are announced), so both stay open. Two fit side by side from
  688 px (two 320 px panels with their margins, `panelsSideBySide`); narrower, one is open at a time and
  the newest stays (also when the window narrows). Reattach still closes the checks panels.
- While its panel is open, a button (Inbox, or Page checks while any of its panels is, and that panel's menu item) is
  highlighted: the UI kit's `soft` variant, as About's hint, on the ink pill in both colour schemes. It says so with `aria-expanded` and names
  its panel in `aria-controls` (a disclosure, so no `aria-pressed` beside it). The Options rows on a phone
  have no state: one panel is open there and it covers the page.
- `components/checks/PageChecks.tsx` owns what the panels keep while closed: the last report of each,
  the comments their quick actions posted (by issue key; keys end with the checked page's path, so after a
  client-side navigation the same finding on another page can be commented again) and the highlighted element. Accessibility and SEO
  check the page in the background ([below](#in-the-background)), so a panel opens with its report. Opening a panel
  checks the page when it has no report of the current page (and none is running); **Check again** runs it again. A report of
  another page (after a client-side navigation) says so.

Security and compliance uses the same panel shell, menu, docking, guest name and finding actions.
Its [security snapshot and response headers](page-checks-security.md) join the retained
[consent inventory and observation](page-checks-consent.md). It performs no background storage or
security work. Response headers require an explicit anonymous request; consent timing requires a
reviewer-started observation. Unknown results stay notes. It makes no security/compliance verdict
and never contributes to the site-wide Accessibility/SEO summary. Its entry points keep the stable
`consent` toolbar feature and panel ID.

## In the background

Both checks run once the toolbar has loaded, without waiting for a panel and without getting in the
person's way
([uier #208](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_HGmaIZ3KHhrhjlIFnduAq)).

- When: once per page (`PageChecks` remounts for every page, so again after a client-side navigation),
  after the page's `load` event (at most 10 s), once it has stopped rendering (`pageSettled`) and when the
  browser is idle (`requestIdleCallback`, at most 5 s; a short timeout where it is missing), all in
  `src/checks/pageIdle.ts`.
- **In short steps** ([review of #568](https://github.com/signalco-io/uier/pull/568)). One axe-core run
  does all its rules in one task (800 ms on a 1,000-paragraph page at 4× slower CPU), so the unasked audit
  never makes one (`auditInSteps` in `src/checks/lazy/accessibilityReport.ts`, in the audit asset). It runs
  the rules axe-core runs by default (`getRules()`, enabled) and `target-size`, each step its own `axe.run`
  when the browser is idle (`nextIdle`): groups of rules on the whole document, then the rules whose work
  grows with every element (`color-contrast` and `link-in-text-block`, which have no page-wide `after` step,
  and `target-size`, which measures neighbours in axe-core's grid of the whole page whatever the run's
  context) on parts of it: disjoint subtrees in document order, and the larger elements above them on
  their own where they have text of their own, are a link, or are a control (`target-size` only). Every
  step keeps what axe-core could not decide too (To review). A step aims at 50 ms: the next takes fewer rules or elements when one took longer, at most twice
  as many when it took less, never under 50 elements (each run also reads the whole page). The steps find
  what one run finds; the elements of a parted rule are put back in document order, and rules of the same
  impact and count keep axe-core's order, so Check again lists the same report.
- **Its bounds.** Over 1,500 elements (`backgroundElementLimit`, the document's own, counted before the
  download) the audit is not run unasked: the panel and Check again check the page at once. A step that
  took over 200 ms (a slow device) ends it the same way. Neither is an error: the button just has no dot.
  An Accessibility panel opened meanwhile waits for it, so its steps no longer wait for idle moments and
  are not limited (opened before it starts, it checks the page in one run).
- **Cancelled when no longer needed.** Each audit has an `AbortController` (`auditControl`): a newer audit
  of the panels (Check again), collapsing the toolbar (unless an open Accessibility panel waits for the
  audit) and leaving the page (a client-side navigation remounts `PageChecks`, Exit review unmounts the
  toolbar) cancel it. The audit queue checks it before loading axe-core and right before every `axe.run`,
  so a cancelled audit waiting for another or for the download never runs, and one between its steps
  stops (a step already running ends first). Its owner hears of it at once. Cancelled by collapsing, the
  page is checked again when the toolbar expands.
- Only where the toolbar can show the result: not while it is collapsed (expanding it starts the
  checks), and the audit only where the Accessibility button is (`auditAvailable()`). Where the browser
  asks to save data (`Save-Data`), the audit is not downloaded unasked; the panel still runs it.
- A check a panel asked for meanwhile is not run twice (`auditedPath`, `seoPath`), and an open panel shows
  "Checking this page..." until the background audit ends. A failed background audit is quiet (opening the
  panel tries again, and says so if it fails then), unless the panel is open by then. One that ended
  without a report (too large a page, too slow a step) leaves the check to the panel, and an open panel
  checks the page then. It never clears a highlight.
- **The indicator.** While a report of this page found something to act on, its item in the Page checks menu gets
  a small amber dot (`AttentionDot`, `--brand-warning`, `data-uier-attention`) and an accessible name that
  says what (`checksButtonLabel`): "Accessibility, 3 issues found" (every element of every rule) and "SEO,
  2 to look at" (the panel's "To look at" count, Core Web Vitals included, so it follows them as the page
  is used; `ChecksAttentionReporter`). The Page checks button gets the dot too, its name adds the sum ("Page checks,
  5 to look at", `pageChecksLabel`) and `data-uier-attention-panels` lists the tools that found something
  (`"accessibility seo"`, for tests). The tooltip stays the button's name. On a narrow screen the dot and
  the name are on the panel's Options row. Without a report, or with nothing to act on, neither changes.

## Layout

The panels share one layout (`components/checks/ChecksParts.tsx`), so they read the same way
([uier #197](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_Z9xMVmu-Ai2HN7Hm-ryXZ)):

- **The title row** (`ChecksPanel`): the handle and the title, then two icon buttons, Check again and
  Close, each with its name as the accessible name and tooltip
  ([uier #206](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_AwJBAvg6X-mTNMYh8MVJA)).
  Check again is never disabled and is `aria-busy` while a check runs.
- **The title is a panel menu** (`PanelTitle`, also the inbox's;
  [uier #299](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_rVMt4sX1T67EuKCMo7hji)):
  the h2 holds a button that opens the panels this review shows (`PanelSwitchContext` from `CommentsGlobal`: the inbox, and
  Accessibility and SEO when they are on and no anchor is being chosen), this one checked. The button and each item
  show the panel's icon before its name, the same icon as its toolbar button
  ([uier #319](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2F&comment=comment_uF0MmPs535f5qBd3Zf-gc)). Choosing another closes this
  panel and opens that one, whose Close takes the focus (one already open on the other side gets it too). ↑ ↓ move
  between them, Escape closes only the menu; with a single panel the title is plain text. The menu is as wide as its
  longest name, each on one line from the start, shortened with an ellipsis on a narrow screen
  ([uier #350](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_V17jODbToGJuzjwYeA7tB)).
  A reviewable part on uier's own pages ("panel menu").

- **The summary first** (`ChecksSummary`): a tile for each kind of result with its count, its icon in
  the result's colour only while it counts something (muted at 0). No line says when it was checked
  ([uier #246](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_zhQXsus05JoFbNA2cAae9));
  an Accessibility report without issues says under it what automated checks cannot tell.
  Each tile is a toggle button (`aria-pressed`, in a group named "Filter results") that shows only its
  results ([uier #222](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_VUQdIFLJjsqv25EgSXjz_),
  [uier #224](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_6WFy0-xb48chE7HJW_Rif)):
  pressed it has a border and the accent background, and a line under the tiles says "Filtered: Serious."
  with **Show all results**, which clears it and gives the focus back to the tile. Pressing it again clears
  it too; a tile at 0 is disabled, and a filter whose count drops to 0 filters nothing. Accessibility
  filters by impact: only that impact's section, without To review and the on-demand sections. SEO
  filters by state through `CheckFilterContext`: `CheckItem` renders only checks in that state, and a
  `CheckSection` hides its other rows (the outline, Check links, previews) and itself without a check
  left. The filter is the open panel's own state: it is gone on another page or when the panel closes.
  The count is `[data-uier-summary-count]` in tests. While a tile filters, the tabs (below) give way to
  every tab's matching results in one list, in the tabs' order; Show all results brings back the tab that was open.
- **Tabs** (`ChecksTabs`), under the summary, so a long report is not one long scroll
  ([uier #223](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_mY3MB3_7kCIlcwKhFLecK),
  [uier #225](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_YOlokHEtM9pDYrCLijzKc)):
  a few groups of sections, not one tab per section. Accessibility: **Issues** (the impacts and To review),
  **Keyboard**, **Screen reader** (with Alt text) and **Visual** (zoom and text spacing, motion). SEO:
  **Page** (Page and Core Web Vitals), **Content** (headings, links, images), **Sharing** and **Search**
  (Crawlers, Structured data, AI search); Sharing and Search only where the audit asset is. They look like
  the inbox's status tabs (underlined), over a line across the whole panel that parts its header from
  the tab's content, 8 px above the first section and 4 px under the summary (the tab buttons' own height spaces
  their names from the tiles; [uier #327](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_DtMPKwYHBnlMeXAGBThfm))
  ([uier #245](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_DGGEw_t-OP-ESUVRu0paQ)), and are ARIA tabs: one tab stop, ← and → move and show the tab they
  reach (`useRovingFocus`, not the UI kit's Radix tabs, whose arrow keys fail in a shadow root). A tab whose
  sections found something to act on has the button's amber dot (`data-uier-tab-attention`) and a name that
  says what ("Keyboard, 2 issues found", "Content, 3 to look at"), counted as the button counts
  (`useSectionsAttention` for the on-demand sections of a tab). Every tab's sections stay rendered, hidden,
  so Show all, an open outline or a tab order drawn on the page stay while another tab is open. The SEO
  tabs show once its report is there: Core Web Vitals shown alone before it would move down when the
  summary comes in, a layout shift its CLS check would count (a shadow root's shift sources are `null`). The open tab
  is kept in module memory per panel: it stays on the next page (a client-side navigation) and when the
  panel opens again; a full page load starts at the first. Tests
  choose one with `showChecksTab` (`e2e/support/toolbar.ts`). A tab may have an `about` text (what its checks can
  and cannot see): an info button at the end of the tab row (`data-uier-tab-about`, outside the tab list's arrows)
  shows the open tab's text in a tooltip, also on a tap, and names it in its description, instead of a paragraph
  in the tab ([uier #349](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_5ibUtgLp61NobAIRQh_rk)).
  A section whose heading would repeat its tab's name passes `hideTitle` to `ReportSection` (the h3 stays for screen
  readers, [uier #351](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_UrMs3PljBvzy0-ixug830)),
  and `groups` puts its checks with a `PageCheck.group` under a heading of their own (with its count), after the rest.
- **Sections** (`CheckSection`): a heading with its count and a short note on the right, over one
  bordered card whose rows are divided by lines.
- **Rows** (`CheckItem`): one compact row per check: the state icon, the name (with a small info button but on a warning),
  a short measurement on the right (`measure`, Core Web Vitals), then what was found on its own line
  (`value`). Why a warning is worth a look (`reason`) is its own muted line under that, so what to fix
  shows without a hover
  ([uier #252](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_zIgm0UQrFHouWK9tOyS4T)),
  and the row has no info button. Why a check passed, or a note, is the info button's tooltip
  ([uier #244](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_r_U5YjZFgfWaCDFTBsmDH)):
  shown on hover, on keyboard focus and on a tap (a second tap, a tap elsewhere or a scroll hides it;
  `useIconTooltip`'s `tap`), and read with the button and the row's actions through `aria-describedby`
  (a hidden element in the row, so the row's text still has it). The button is named "About <check>".
- **Issues** (`IssueList`): one muted row per element, its short name with Highlight and Comment on the
  right. A line every issue of a list shares is said once (by the check's reason, or under the rule's
  title), not on every element (`sharedSummary`); a single SEO issue's detail is in its check's reason.
  So an SEO check whose count alone doesn't say why (link addresses, heading levels) adds the shared line
  to its reason ("2 links look broken. It runs a script instead of opening a page.").

## Across pages

An open inbox, Accessibility or SEO panel stays open on the next page and shows that page
([uier #196](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_5qyBH-wrDYC5Vim0dgff-)).

- `CommentsGlobal` remounts for every page (keyed by the path), so `src/openPanel.ts` keeps the open
  panels (one, or two on different sides) in module memory for client-side navigation and in
  `sessionStorage` (`uier:toolbar-panel`, comma-separated, oldest first) for a full page load, fitted
  again to the window and the panels' sides when restored. A full load restores it only when it continues the tab on the site (a same-origin
  referrer with history before it, back or forward, a reload); a page opened anew, such as from a
  review link, starts without one. So does a window opened from the site: it gets a copy of the
  opener's `sessionStorage` and its referrer, but no history of its own (`history.length` 1). Exit
  review forgets it; `feedback` mode and an Accessibility panel without its audit never restore.
- The inbox keeps its filter (status, pages, search) across client-side navigation only, in memory: its
  search is never written to the site's storage. "This page" then lists the new page, and a page chosen
  in the picker that the inbox then reaches is "This page" too (`useInboxComments`), with its comments.
- A restored panel (`RestoredPanelContext`, the restored panels still open) neither slides in nor takes
  the focus, so a link click leaves the focus on the page; the showcase hint stays closed. One closed
  and opened again behaves as usual, and opening a panel on the other side leaves a restored one as it is.
- A restored checks panel checks the new page once it has rendered (`src/checks/pageSettled.ts`: no
  added, removed or edited nodes for 300 ms, at most 3 s), since a client-side router can change the
  address before the page. Two restored checks panels wait together. The Accessibility panel shows
  "Checking this page..." meanwhile; Check again checks at once (and the other panel waiting with it). An audit still running from the previous page is not reused: the new one waits for
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
  and WCAG 2.2's target size (`target-size`, 2.5.8 AA, off by default in axe-core) on the document,
  excluding the toolbar's host and inline thread slots by reference, without frames
  (`iframes: false`). One audit runs at a time: one asked for while another runs waits for it, then
  checks the page as it is then (never sharing the running one's report), and the panel shows only its
  latest audit; a newer audit cancels the previous one ([above](#in-the-background)). Asked for (the panel,
  Check again), it is one `axe.run` of the whole page; in the background, short steps. The run and its
  report are in the audit asset (`lazy/accessibilityReport.ts`); `accessibility.ts` is the queue in the
  review bundle. The panel lists only what axe-core finds
  ([uier #198](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fbrand&comment=comment_fCCTyY6zuzO3K_Kr-DALq)):
  the status ("3 issues found.", read out only: the tiles show the counts, [uier #226](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_rBu2-JZLowGgsaVmjl9o-);
  "Checking this page...", a failure and "No issues found." show), a summary tile per impact with its
  elements' count, when it was checked (not with what: the checks change, [uier #227](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_Im2uENyTKFmnJbPng8NWD)),
  then, in the Issues tab, a section per impact (critical, serious, moderate, minor); with nothing to fix
  or review, the tab has a placeholder instead, the empty inbox's dashed card with a green check
  (`data-uier-issues-empty`, [uier #253](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_M17IoxbxT-BVD8dYars39)),
  above any rule left only with issues marked "Not an issue". Each rule is a row marked with its
  impact's icon in its colour (`impactStyles`: the priority colours, a shape each, see `BRAND.md`,
  "Accessibility impact"), its help text, id, the standard it tests (`ruleStandard`, from axe-core's tags: "WCAG 1.4.3 (AA)",
  or "Best practice") and **How to fix** link (Deque University, without its tracking query); each element is a row with its short name (`img#hero.logo`). axe-core's first failure
  line is said once under the rule's title when every element shares it, else on each element, two lines
  at most (the whole line is its `title`, and screen readers read all of it). Without issues the panel
  says so in one line, with a reminder to also try a keyboard and a screen reader.
- **To review**: what axe-core could not decide (its incomplete results: contrast over an image or a
  gradient, a target it cannot measure) is a section of its own after the impacts, in the Issues tab, each rule with a search icon, its elements and the reason axe-core gave (the
  messages of its undecided checks), with Highlight and Comment. They are not issues: they are in no
  count, tile or dot ([page-checks-report.md](page-checks-report.md)).
- **Not an issue** hides a finding in this browser: it leaves the counts, the tiles and the button's
  dot, and is listed folded under its rule as "Dismissed" with Restore ([page-checks-report.md](page-checks-report.md)).
- Packaged clients (the browser extension) never inject a remote script: they package the audit asset,
  built from the same `auditEntry.ts` without a published path, and their adapter runs it in the toolbar's
  isolated world when a check runs (`ToolbarAdapters.loadAudit`, [the extension adapter](extension-adapter.md#the-audit-asset)).
  There it hands over through that world's own global, which the page's scripts never see, instead of a
  script element. So `auditAvailable()` is true there, and the Accessibility button, the background audit
  with its bounds and every section behave as on the web. A client without `loadAudit` has no audit.

## SEO

`src/checks/seo.ts` reads the page's own document when the panel opens (the toolbar's shadow root and
inline threads are never in `document.querySelectorAll`); the hreflang, image and link-status checks run
in the audit asset and show in the same sections ([more Page, Links and Images checks](page-checks-seo-page.md)).
Each check is pass, warning or a note (not measured, not needed), with a one-line reason. The summary
counts what is worth a look (warnings,
amber) and what passed (green); notes are not counted. The heading outline is folded under the heading
checks (a `details` row, "Outline").

- **Page**: indexing, the title (10 to 60 characters), the meta description (one, 50 to 160 characters),
  the canonical link (one, valid, pointing to this page's origin and path), the viewport
  (`width=device-width`, else phones show the page zoomed out), the language (`html[lang]`, a note when
  missing) and, on a page with hreflang tags, their values, addresses, duplicates, this page among them
  and the canonical address ([more](page-checks-seo-page.md#page)). Indexing reads the
  `robots` and `googlebot` meta tags: `noindex` (or `none`) is a note that the page asks search engines
  (or Google) not to index it, and on such a page a missing canonical link is a note, "Not needed",
  not a warning ([uier #195](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_1hEpNjurDgh70vdAEO8Tn)).
  The uier app's pages declare `noindex` on purpose ([search indexing](../../../apps/web/docs/search-indexing.md)).
  A canonical that is there is still checked. The `X-Robots-Tag` response header is not in the document:
  the Crawlers section reads it from the page's response ([crawlers](page-checks-crawler.md)).
- **Headings**: one h1, no skipped levels (an h3 right after an h1), no empty headings, and the outline.
- **Links**: the count (this site and other sites), links without text (text, `aria-label`,
  `aria-labelledby`, `title` or an image's alt text), and addresses that look broken: empty, `#` alone,
  `javascript:`, not valid, containing `undefined`/`null`/`NaN`, `http` on an `https` page, or a `#id` on
  this page that is not there (hash routes and `#top` excepted). Generic link text ("read more", "click
  here"; English, so not on a page in another language). **Check links** requests the page's links to its
  own site only when pressed (at most 100, a few at a time, never one that looks like an action) and
  reports the ones that answer with an error ([more](page-checks-seo-page.md#links)).
- **Images**: `img` elements without `alt`, unless marked as decoration (`role="presentation"`/`none`,
  inside `aria-hidden="true"`). When the panel opens: images without dimensions, files over twice the
  size they are shown at, `loading="lazy"` where the visitor looks first, and files over 500 KB
  ([more](page-checks-seo-page.md#images)).
- **Core Web Vitals** (`src/checks/webVitals.ts`), measured in this browser with the Performance Timeline
  and updated while the panel is open: LCP (buffered `largest-contentful-paint`, from a prerender's
  activation), CLS (the largest session window of `layout-shift` entries without recent input) and INP
  (`event` entries from 16 ms, the longest per interaction, one left out per 50 interactions). Measuring
  starts with the review layer (`startWebVitals` in `PageChecks`), and buffered entries reach back to the
  page's load. The toolbar is left out: candidates and shift sources in it, and its own interactions,
  known by their target or by their events' time stamps (a press that removes its button reports no
  target). Targets: 2.5 s, 0.1 and 200 ms; a browser without an entry type says "Not measured in this
  browser", and INP without slow interactions passes as "Every interaction so far took under 104 ms".

## Sections

Checks added after the first two panels run on demand, in the audit asset, and show as sections of a
panel. The review bundle (1.22 MB of the 1.5 MB a published bundle may be, the message editor about 240 KB of it) gets only their views.

- **The logic** is one module per area in `src/checks/lazy/` (`crawler.ts`, `sharing.ts`, ...), bundled
  into `dist/audit.js` beside axe-core and handed over with it (`auditEntry.ts`, `auditHandoff.ts`;
  `loadChecks()` in `axeLoader.ts`). Whatever a module exports is its part of `LazyChecks`
  (`lazy/index.ts`). These modules read the page and return plain data and page elements: no React, UI
  kit, hooks or components, since those would be bundled a second time. `lazy/api.ts` has what they
  share: `SectionContext` (the path, an abort signal), `SectionReport` (checks, a count, a note, the
  section's own `details`) and the builders `pageCheck` and `pageIssue`.
- **A section** is a definition and a component, one file per area in `components/checks/sections/`:
  `defineSection({ id, panel, when, run, attention? })`, the area's list of definitions
  (`crawlerSections`), and a component that reads its state with `useSection(definition)` and shows it,
  usually with `ReportSection` (the checks as compact rows, then the section's own rows).
  `sections/index.ts` lists every area, and the panels render the components in their order, each in its
  tab ([Layout](#layout)); a new section joins the tab it fits and counts toward its dot.
- **When it runs** (`when`): `background` with the background checks, one section at a time when the
  browser is idle, only where the audit asset is loaded unasked (not with `Save-Data`, not over 1,500
  elements) and only for work of a few milliseconds without requests; `panel` when its panel opens and
  on Check again; `manual` only when its own control asks (`useSection(...).run`), for work that takes
  long, sends requests or changes the page while it runs. Check again drops a `manual` report.
- **Its state** is kept by `PageChecks` like the two reports (`useSectionsStore`): `idle`, `checking`,
  `done` with the report, `failed` (said in the section and the console) or `unavailable` (no audit asset:
  a packaged client without it, where the section renders nothing). A newer check of a section replaces
  a running one, and leaving the page cancels them (`SectionContext.signal`).
- **The indicators** count them: the SEO summary and the SEO button count the sections' checks worth
  a look, the Accessibility button the issues of their `warn` checks (a definition's `attention` says
  otherwise).
- **Tests** get their own page without changing the shared server: `site.origin('fixture-<name>')` is
  the reviewed site with the additions of `apps/web/e2e/support/fixtures/<name>.ts` (head, body, CSS,
  headers, CSP, other addresses).

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
    One to review is `Accessibility (to review): <help>.`, its reasons under "axe-core could not decide:",
    then "A person needs to check this." before the standard.
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
- **Comment on all** (under every list, `IssueList`: a rule's, an SEO check's, a section's) posts one
  comment for the list's elements not reported yet, at least two of one check: pinned to the first,
  its text lists their selectors as far as 1000 characters go ("and 4 more"), and its check has their
  `count`. One request, so the API's limits (`too_fast`, `page_full`) and a failure are as for one
  comment. Every element it covers is marked by it, after a reload and for every reviewer too
  ([page-checks-report.md](page-checks-report.md)).
- **Not an issue** (an icon on every row of a finding of the page as checked; not on Core Web Vitals,
  which are measured live, nor on a reported one) hides it in this browser only, folded under its list
  as "Dismissed" with **Restore**; a check whose every issue is dismissed is a note
  ([page-checks-report.md](page-checks-report.md)).
- A project's guest without a saved name gets the comment form's name field above the issues; a quick
  action asks for it first and saves it like the form does. One name for both panels, but each open panel
  has its own field (`GuestNameField panel`, kept by panel in `GuestNameProvider`): a quick action focuses
  and marks the field of the panel it was pressed in, also after the other panel closes.

## Bundle and loading

The panels' code is in the review bundle (about 32 KB minified, no new dependency there); axe-core
(about 680 KB) is still its own asset, loaded on use: by the background audit once the page is idle
(on pages of up to 1,500 elements), or by the panel. Its evaluation is one task (about 190 ms at 4× slower
CPU locally). Nothing here runs for ordinary visitors of a project's site: the review bundle itself loads
only for reviewers. uier.io's own public pages show the toolbar to everyone (`showcase` mode), so there the
background checks run for every visitor whose browser does not ask to save data.

The browser extension ships the same asset as `audit.js` in its package (about 680 KB, about 190 KB of
the ZIP), never in its content script, which holds the review bundle. On a document's first check the
content runtime asks the worker, which runs the file in the reviewed tab's isolated world
(`scripting.executeScript`, the review's own activeTab access): no download, no new permission, no
web-accessible resource, and the page's CSP does not apply to it. The rules above are the same there.

## Tests

`apps/web/e2e/page-checks.spec.ts` on a project's site on another origin with the install guide's CSP
(`?page-checks` in `e2e/support/reviewedSite.ts`): one audit request in the background, the buttons' dots
and names before a panel opens, the panel opening with that report and no new request, rules by impact without the toolbar, Highlight, a comment posted on the element with its
screenshot, details, failure lines, standard and check, Show, focus back on Close, the impact tiles' counts and a rule's shared line said once, the Issues tab's placeholder on a page without `?page-checks` (Desktop Chrome); the SEO checks, a warning's reason in its row and a pass's in its tooltip, the summary's counts,
the folded outline, Core Web Vitals not counting the toolbar's presses, a guest's name (also asked in the panel commented from with both panels open, and after one closes), page feedback, an
element's comment with what was found and its check, findings marked as reported after a reload (with Show) until their thread is done, a noindex page (its Indexing note, no canonical needed) and broken links sharing one reason (Desktop Chrome);
the tabs (the sections of the shown one, a tab's dot and name, ← and →, a filter listing every tab's results) (Desktop Chrome);
the panels from Options on a phone, their rows marked by the background checks, fitting the screen (Mobile Chrome); the SEO panel and the inbox
staying open across a client-side navigation, a same-site full load and a reload, and not on a page
opened anew; an Accessibility panel left open while the previous page's audit still runs (a slow
axe-core) showing the new page's report, a window opened from the site starting without the panel, and
the inbox showing another page listing its comments once it reaches that page (Desktop Chrome).
A background audit nobody needs any more (a slow axe-core, then collapsed while it loads, collapsed between
its steps at 4× slower CPU, and Exit review while it loads) never runs again, counted through the audit
handoff (`e2e/support/auditRuns.ts` wraps axe-core's `run`, no hook in the toolbar), and checks the whole page once expanded again (Desktop Chrome).
`launch-performance.spec.ts` waits for the background audit of a 250-section page with issues (1,027
elements) at normal and 4× slower CPU while pressing a button of the page: in more than one run, no long
task from its download to its report reaching 100 ms (normal) or 250 ms (4×), the presses under 250 ms;
over the element limit (1,000 sections) nothing is downloaded or run unasked, and the panel checks the page
in one run (Desktop Chrome; `audit-performance.json`).
`comments.api.spec.ts`: a comment keeps its `check`, the packet names it, and other values are refused.
`toolbar-assets.api.spec.ts`:
the audit asset is pinned by path and SRI in the review script, absent from the loader and the review
script, and served with CORS and immutable caching.
