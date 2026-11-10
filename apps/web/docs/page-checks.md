# Page checks

A project's **Page checks** (`/app/projects/<id>/page-checks`, the tab after Comments) shows what the
toolbar's Accessibility and SEO checks found on each page its members reviewed. The toolbar checks every
page a member opens in the background ([the panels](../../../packages/toolbar/docs/page-checks.md)) and
saves a small summary of that page to the project
([the reporter](../../../packages/toolbar/docs/page-checks-site.md)). The view puts the project's pages
together: which pages have the most to fix, and what only shows across pages.

## What is stored

One `page-check` document per page and environment in the `app` container, in the project's own partition
`page-checks:<projectId>`, with the id `page_<SHA-256 of origin and page>` (`src/lib/pageChecks/store.ts`):

- the site's origin the request came from (`projectReviewOrigin`, like a comment's) and the canonical page key
  under the project's page state (`pagePath`), with its trailing-slash link form when it had one (`sourcePath`);
- the page's title (up to 200 characters) and meta description (up to 300), plain text on one line, and
  whether it asks search engines not to index it;
- axe-core's issues by impact (none when the audit did not run in the member's browser), the SEO checks to
  look at and passed (the SEO panel's summary: Core Web Vitals and its sections included), each check's state
  by `seo:<id>` or `accessibility:<id>` (at most 150), and LCP, CLS and INP when they were measured;
- when it was saved, and the previous check's counts and time (`previous`).

Nothing names an element, the page's other text or the member who sent it. The latest summary replaces the
page's previous one. A project keeps up to 200 pages: a new page beyond that removes the least recently
checked ones (`makeRoom`: an exact count, then the partition's documents, only when a new page arrives at
the cap). A page not checked again for 90 days expires (per-item `ttl`, counted from the last write).
Deleting the project removes the partition (`deleteProjectPageChecks` in `projectDeletion.ts`'s records
pass); a transfer keeps it, since it is keyed by the project.

## Who writes and reads it

- **Writes**: `POST /api/review/<code>/page-checks` ([API](../../../docs/api.md#page-checks)), through
  the review API's identity, CORS, origin and BotID verification (`reviewApiHandler`), from project members
  only: guests and public viewers get `403`, and an invited project's non-members `401` first. The body is a
  strict object with bounded numbers, strings and maps (`src/lib/pageChecks/schema.ts`), and is validated before
  the limits count it: 120 summaries per member per hour and 2,000 per project per day, counted in the
  project's comment partition like the other review limits (`src/lib/pageChecks/limits.ts`).
- **Reads**: the view's server page, for anyone who can see the project (`getVisibleProject`), like its comments.
  One single-partition query of at most 200 documents per render; each check's state stays on the server
  (`pageCheckRow`), the browser gets the counts.

## The view

`PageChecksView` (`src/components/app/pageChecks/`), built from the UI kit's `Table`, `Card`, `Badge`,
`Select` and `Empty`:

- Full width like Comments (uier #214): the view breaks out of the reading column to the panel's width less the
  gutters, capped at 96rem (`page-wide`, `data-header-wide="list"` for the project header, [app shell](app-shell.md)).
- The caption says where the results come from: members' browsers at the time of each visit.
- **Across pages** (`AcrossPages`, `pageCheckInsights` in `src/lib/pageChecks/insights.ts`, pure): indexable
  pages of one site address that share a title, or a meta description (case and spacing aside), indexable
  pages without a description, and pages that ask not to be indexed. A `noindex` page is left out of the
  first three: it is not in search results. Each card's pages are closed until its "Show pages" button opens
  them (uier #219), in a scroll of at most 20rem, with a search (address or title, and the shared text) when
  there are more than six. They are listed as a hierarchy of their addresses (`pathTree` in
  `src/lib/pageChecks/pathTree.ts`, pure): unusual paths with empty segments stay exact flat entries so no
  page link is lost; otherwise a level per path segment, a query under its path, a level that is not a page and holds one level merged into it, under each environment's name when they are from several.
  A page under a level shows the rest of its address; the whole address stays its link's name.
- **Pages**: a table from the `@3xl` container width (a card per page under it, like the site addresses
  table): the page (its address opens it in review in a new tab, with `projectReview`; an address no longer
  among the project's is text), its title (and environment when the project has several), axe-core's issues by
  impact, the SEO checks to look at and passed, Core Web Vitals against the panel's targets, when it was last
  checked and the change since the check before. Each result is an icon in BRAND.md's colours beside its words.
- **Order** (`?sort=`, `setUrlSearchParams`, no server request): Needs attention first by default (critical,
  then serious, then all accessibility issues, then SEO to look at, then Core Web Vitals over target),
  Accessibility issues, SEO to look at, Last checked or Page. A column the order follows has `aria-sort`.
- **Show** (`?show=`, uier #221, `filterPageChecks` in `insights.ts`): All pages by default, Needs attention
  (accessibility issues, SEO to look at or a Core Web Vital over target), each of those three alone, or Passes
  all checks (audit present, SEO results present, all three vitals measured, and no issues). Incomplete checks
  lists pages missing any of those results, even when known results also need attention. Each
  option shows its count; the heading says "Pages 3 of 21", and a filter that shows none says so with Show all
  pages.
- Empty: "No pages checked yet", how pages get here, and that reviews in the browser extension are not
  included yet (packaged clients do not send summaries).

The tab is always in the project's header (`ProjectTabs`), after Comments.

## Tests

`e2e/page-checks-site.api.spec.ts` (API): members only (guests, public viewers, other tokens and other sites
refused, the site's verification proof), strict validation and the largest summary, replacement with the kept
previous counts and the page state, the 200-page cap, the member and project rate limits (validation first),
deletion with the project, the across-pages, ordering and filter rules, and the address hierarchy.
`e2e/page-checks-site.spec.ts` (full suite): a member reviews two pages of the `fixture-site` site with the same
title; the toolbar sends one summary each (not again for an unchanged reload), and the view lists both with
their counts, the shared title and description (closed until opened, under their common path), shows only the pages needing attention, sorts by page and passes axe (Desktop Chrome); a `noindex`
page as a card on a phone, without a sideways scroll (Mobile Chrome).
