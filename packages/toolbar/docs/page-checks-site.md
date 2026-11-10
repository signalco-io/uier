# Page checks across the site

The panels see one page at a time, but the checks already run in the background on every page a reviewer
opens ([page checks](page-checks.md#in-the-background)). `components/checks/PageSummaryReporter.tsx` sends
a small summary of each page's results to the project, and the app's **Page checks** view shows the
project's pages together ([the view](../../../apps/web/docs/page-checks.md)). It renders nothing.

## When it sends

- Only for a **signed-in project member** in `review` mode with `data-uier-project` (`useProjectViewer().isMember`):
  never for guests, public viewers, `showcase` or `feedback` mode. Not in packaged clients for now: the
  extension's route contract is closed, so nothing is sent when `runtimeAdapters()` is set.
- After the reports settle: once this page's SEO report is there, and the audit's too when one is on its way
  (the asset is loaded unasked: `auditAvailable()`, no `Save-Data`, up to 1,500 elements; after 30 seconds of
  the review layer showing without it, the summary goes without the audit's counts), 3 seconds after the last
  change of what it would send. Never while the toolbar is collapsed (`usePageLayerVisible`) or the tab is
  hidden: the wait starts again when both show.
- Once per page and change: `PageChecks` remounts for every page, and `pageSummary.ts` keeps what this
  browser sent per page (a short fingerprint of the summary and the time) in the reviewed site's local storage
  (`uier:page-checks:v1:<api>:<project>`, at most 100 pages, entries older than a day dropped; in memory
  where storage is blocked). An unchanged page is sent again after a day, so the view's "last checked" stays
  honest; one that failed, after an hour. The exact Core Web Vitals values are not part of the fingerprint
  (whether they are over their targets is, through the SEO counts), so using the page does not send it again.
- A failed send is quiet and not retried on this page load; after a `429`, nothing more is sent from it until
  its `Retry-After`.
  The request goes through `apiRequest`, with the review token and the cross-origin verification proof
  like every review write.

## What it sends

`POST /api/review/<project>/page-checks` ([API](../../../docs/api.md#page-checks)), `PageSummary`:

- `path`: the page key the comments use (`CommentsBootstrapperContext`'s, under the project's page state),
  and `sourcePath` with its trailing slash when it had one, never the address with its query;
- `title` and `description`: the SEO report's values, one line of plain text, capped at 200 and 300
  characters, and `noindex` (the Indexing check is a note);
- `accessibility`: axe-core's issues by impact (every element of every rule), only with the audit's report;
- `seo`: the SEO panel's summary, `warn` and `pass` (its checks, Core Web Vitals and its sections');
- `checks`: each check's state by `seo:<id>` and `accessibility:<id>` (the SEO checks and sections, the
  rules axe-core found as `warn`, the Accessibility sections), ids of lowercase letters, digits and hyphens
  only, at most 150;
- `vitals`: LCP and INP in milliseconds and CLS, only those measured.

No element, selector, other page text, comment or reviewer detail. The server keys the page by the site's
origin the request came from.

## Tests

`apps/web/e2e/page-checks-site.spec.ts` on `fixture-site` (`e2e/support/fixtures/site.ts`: every page has the
reviewed site's title, `/pricing` and `/plans` share a description, `/private` is `noindex`): a member's review
sends one summary per page with only these fields, nothing again for an unchanged reload, and the app lists
both pages. `apps/web/e2e/page-checks-site.api.spec.ts` covers the route and its store.
