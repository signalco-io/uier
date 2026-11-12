# Page checks: what the panels report and how

How the Accessibility and SEO panels ([page-checks.md](page-checks.md)) decide what is an issue, what
a person has to judge, how several findings become one comment, and what a reviewer hides as not an
issue.

## Target size (WCAG 2.5.8)

- axe-core 4.14 has `target-size` (WCAG 2.5.8, AA) but does not run it by default. The audit turns it
  on (`addedRules` in `src/checks/lazy/accessibilityReport.ts`): `rules: { 'target-size': { enabled: true } }`
  for the one `axe.run` the panel asks for, and the background steps list it beside the enabled rules.
  `ruleStandard` reads its tags (`wcag22aa`, `wcag258`) as "WCAG 2.5.8 (AA)".
- It checks every control that can take the focus (not links inside a line of text) against its
  neighbours: under 24 by 24 px, or without 24 px of room around its centre. Its work grows with the
  controls on the page (about 100 ms for 1,000 elements at 4× slower CPU in one run, over 250 ms with 500
  small buttons), so in the background it is one of the per-element rules that run on parts of the
  document (`perElementRules`). An element's result does not depend on the part: axe-core measures
  every target in its grid of the whole page, built from every element whatever the run's context. A
  control larger than a part (a `select` with many options) is checked on its own (`controlRules`, for
  any larger element that may take the focus), so nothing one run finds is missed.

## To review

- What axe-core cannot decide (its incomplete results) used to be dropped (`resultTypes: ['violations']`
  keeps one element of each other type). The audit asks for both (`['violations', 'incomplete']`), in one
  run and in every background step, which merges them like violations, in document order for the
  per-element rules. A rule that failed to run (`error`) is left out: there is nothing to judge.
- `AccessibilityReport.review` holds them as rules (`AccessibilityRule.review`), sorted like the issues.
  An element's reason is the messages of its undecided checks (`any`, `all`, `none`; for these
  `failureSummary` repeats them under "Fix any of the following:", which does not fit), such as
  "Element's background color could not be determined due to a background gradient".
- The panel shows them after the impact sections, in the Issues tab, in "To review"
  (`data-uier-review`, a search icon on each rule, "axe-core could not decide. Not counted."), with
  Highlight, Comment, Comment on all and Not an issue like the issues. They are in no count: not in
  "3 issues found.", the impact tiles, the button's name or its dot. Their keys start `a11y-review:`, so a
  posted comment marks the right row. The comment starts `Accessibility (to review):`, lists the
  reasons under "axe-core could not decide:" and ends "A person needs to check this." with the standard
  and the rule's page.

Security and compliance also uses the finding controls: `review: true` on its findings, the shared
Comment and Not an issue actions, stable `consent` check IDs and browser-local dismissal. Consent suggestions count under **To review**, never as legal violations or automatic passes.
The security tabs count passed declarations separately and keep unknowns as notes ([security scope](page-checks-security.md)). It cannot
automatically re-check a thread: consent timing requires another reviewer-controlled observation
([scope and evidence](page-checks-consent.md)).

## Comment on all

- Every `IssueList` (a rule's elements, an SEO check's, a section's `CheckItem`) offers **Comment on all
  N** under its rows when at least two of its elements of one check are not reported yet. It posts one
  comment through the same create as one element's (`useIssueComment`, with the screenshot and the
  browser's details): `groupIssue` in `src/checks/issueGroup.ts` builds it. It is pinned to the first
  element; its text is the group's first line (a rule: `Accessibility (serious): <help>.` and the line
  every element shares; a check: `SEO (<label>): <reason>`), "N elements:" (or "N of its M elements,
  not reported before:"), one line per element with its selector (axe-core's, else the first of its
  anchor selectors) and what differs between them (its summary, an SEO finding's `Heading: ...` lines),
  as many as fit in 1000 characters with "and N more" after them, then the rule's standard and page.
- The request's check carries `count` (`CommentCheck.count`, 2 to 10,000; [the API](../../../docs/api.md#comments-api)),
  so it is one request: the API's limits (`too_fast`, `page_full`) apply to it as to one comment, and a
  failure shows the usual toast and brings the button back. While it posts the button says "Posting..."
  (`aria-disabled`); then it is Show, with "Comment posted for N elements as #12" beside it, so the focus
  stays where it was. It is described by its list's name.
- Afterwards every element it covered is reported (`reportedComment`): an open thread with the same
  check and a `count` on this page covers the check's issues with an element on this page, after a
  reload and for other reviewers. A thread about one element still comes first. A rule's issues and its
  "To review" elements are separate lists of the same check: a thread for several does not cover one
  of them when the element it is pinned to (its first) is in the other (`covers` in `PageChecks`).
  Done threads do not count, as for one element. Older comments have no `count` and keep matching by
  their element; an older toolbar sends none.

## Not an issue

- Every finding of the page as checked (an issue with a `path`; not Core Web Vitals, which are measured
  live) that is not reported has a **Not an issue** icon button (`data-uier-dismiss`). It hides the
  finding in this browser: out of its list into a folded "Dismissed N" list under it ("Not counted.
  Hidden in this browser only.", each with **Restore**), and out of every count: the Accessibility status,
  tiles and section counts, the SEO summary ("To look at"), both buttons' names and dots, and the
  sections' attention. A check worth a look whose every issue is dismissed is a note (`none`): a
  deliberate choice. The focus moves to the next row's same action, else to the fold (Restore: to the
  next Restore, else back to the list).
- `PageChecks` applies it to the reports before the panels see them (`withoutDismissed`: `issues` keeps
  the others, `dismissed` the hidden ones, on `AccessibilityRule` and `PageCheck`), also to the sections'
  states it provides through `SectionsContext`, so `sectionChecks`, `sectionsAttention` and the
  sections' own views leave them out without a change there. `IssueList` also leaves out any issue the
  context says is dismissed, for a list built outside a check. `PageSummaryReporter` gets the reports
  as checked: the dismissals are this browser's.
- Kept in the reviewed site's storage (`src/checks/dismissedIssues.ts`, the drafts' adapter storage in a
  packaged client, memory where storage is blocked), one key per API and project
  (`uier:checks-dismissed:v1:["<api>","<project>"]`): at most 300 entries, the oldest dropped, each
  expiring after 90 days. An entry is a hash of the check (`type`, `id`, to review or not) and the
  page's path, then a hash of the element's anchor selector (`anchorSelector`, as comments are pinned;
  not the per-session `elementKey`), so a finding is known again after a reload. Only findings of a
  check and page with an entry need their selector worked out.

## Tests

`apps/web/e2e/page-checks-report.spec.ts` on `fixture-report` (`e2e/support/fixtures/report.ts`: three
images without alt text, controls under 24 px close together, a 16 px `select` with 60 options, text on a
gradient; `?many` adds 40 small buttons with long ids), Desktop Chrome: target size by the background
steps and by Check again, the same elements, "WCAG 2.5.8 (AA)"; the gradient's contrast to review with
its reason, not counted, and its comment; one comment for a rule's three images and an SEO check's
(their text, pin, `count`), one for 45 targets within 1000 characters ("and N more"), all reported after
a reload, the undecided list not covered; Not an issue out of the status, tiles, the button's name and
the SEO count (a page issue's check a note), the focus, kept after a reload, Restore. Each runs
`expectNoAxeViolations` on the open panel. `page-checks-report.api.spec.ts`: `check.count` saved,
listed, in the packet ("· 5 elements"), 2 to 10,000, other values and other fields refused, a check
without it as before.
