# A finding's check, run again in its thread

A comment posted from the Accessibility or SEO panel carries its check (`CommentItem.check`,
[page checks](page-checks.md#quick-actions)). Its thread can run that one check again where it was
found, so whoever verifies the fix ([fix verification](fix-verification.md)) has evidence beside their
own look. It never changes the thread's status: the reviewer still confirms or reopens.

## Where it shows

- `components/checks/CheckRecheck.tsx`, in `CommentThread`: the thread of a comment with a `check`,
  open on the page (and environment) it was posted on: a pin's popover, an inline thread, or the inbox
  card of a comment of this page. Not for another page's comments, and not in the app (it is not on the
  reviewed page).
- One compact line with **Check again**: "Accessibility check: image-alt" until it runs, "Checking..."
  while it runs, then the result: "Still found on this page." with the short reason (axe-core's first
  failure line, the SEO check's reason or the element's summary), "No longer found on this page.", or for
  a comment about several elements (an optional `check.count` of 2 or more) "3 elements still fail this
  rule". Core Web Vitals say this visit's measurement against its target ("3.1 s in this visit, over the
  2.5 s target."). One that failed (the audit asset did not load) says "This could not be checked. Check
  again to retry." The text is a `role="status"`; the icon (`checkStates`) only repeats it.
- Under the messages; while the thread is Ready to verify, inside the Fix verification section between
  the request and the answers (`CommentVerification`'s `evidence`).
- Nothing at all when the check cannot run here: no audit asset (`auditAvailable()`, packaged clients)
  for axe-core rules and the panels' sections, a `custom` rule, an unknown Core Web Vital or one this
  browser does not measure, or the comment's element not on the page. Some of this is known only once it
  ran (a rule this axe-core no longer has, a check id no section reports, a hidden element): the line then
  goes away.
- A project-hidden Accessibility or SEO tool also hides its thread re-check (Core Web Vitals follow
  SEO), including the automatic Ready to verify check. The existing thread and its status/verification
  controls stay available; this uses the same effective visibility list as the panels
  ([toolbar features](../../../apps/web/docs/project-settings.md#toolbar-features)).

## When it runs

- Ready to verify: once, on its own, when the thread opens (also when it turns Ready to verify while
  open). Otherwise only on **Check again**. Never on a render or a refetch.
- One re-check at a time per thread (Check again is `aria-busy` meanwhile and does nothing), and one at a
  time across threads (`recheck` queues them, so an inbox with several Ready to verify findings checks
  them one by one). Closing the thread or leaving the page (`CommentsGlobal` remounts per page, the line
  is keyed by the path) cancels it through its `AbortSignal`.

## How each kind is checked (`checks/recheck.ts`)

- **The target.** A comment about the page (page feedback) or about several elements is checked on the
  whole page. A comment on an element resolves its anchor (`resolveAnchorElement`) and is matched like
  `reportedIssue.ts`: a finding whose element's page anchor (`pageAnchorElement`) is the comment's. A page
  finding pinned to the main content (every page feedback type off) also matches a finding without an
  element.
- **`accessibility`**: that one rule, `runOnly`, through `withAxe` (after any running audit), without the
  toolbar (`auditExcluded()`). On the comment's element alone for `color-contrast` and
  `link-in-text-block` (their work grows with every element and they judge each element on its own); every
  other rule runs on the whole page and is matched to the element, since many compare an element with the
  rest of the page (`heading-order`, `landmark-unique`, `duplicate-id-aria`, the page-level rules). A hidden
  element cannot be checked (axe-core leaves it out, so it would look fixed). An id this axe-core does not
  have goes to the Accessibility panel's sections.
- **`seo`**: `checkSeo(path)`, the check by id. On an element: whether it still has an issue there. About
  the page: whether the check is still a warning. An id that is not in that report goes to the SEO panel's
  sections.
- **Sections**: every definition of that panel in `sectionDefinitions` that is not `manual` (those take
  long or change the page), one at a time with `loadChecks()`, until one reports the id (a row with that id,
  or an issue with that check). A section that throws is skipped. An id nobody reports cannot be checked.
- **`web-vitals`**: `vitalCheck` with the current `useWebVitals` measurement: this visit, in this browser.

Its words claim no more than what ran: this check, now, in this browser, on this element (or page).

## Tests

`apps/web/e2e/page-checks-verify.spec.ts` on `fixtures/verify.ts` (an image without alt text, a script
link, no meta description; `?fixed` fixes all three): findings posted from the Accessibility and SEO
panels say "Still found" on Check again, then "No longer found" once the page is changed, with the status
unchanged and the thread accessible; a guest's findings created through the API: a `custom` rule shows
nothing, page feedback in the inbox is checked when asked, a thread asked to verify checks itself between
the request and the answers, and on the fixed page opening it says "No longer found" without a click
(Desktop Chrome). The `count` wording is not covered: the API keeps only `type` and `id` in this branch.
