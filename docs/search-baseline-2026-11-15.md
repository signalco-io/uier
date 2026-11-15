# Search rollout baseline — 15 November 2026

Owner: [AleksandarDev](https://github.com/AleksandarDev). Tracking issue: [#311](https://github.com/signalco-io/uier/issues/311).
This records available evidence and a manual measurement procedure. It adds no tracking or scheduled work.

## Evidence available today

The initial audit identified `d8071a1433d59da9ff786e4b3a1dc8e4e1813fbe`, with 37 static pages
and 38 sitemap URLs. Source was reviewed at `26b46774` before implementation.

The new batch is now published. [PR #794](https://github.com/signalco-io/uier/pull/794) merged as
`d3046ee6`; [production Deploy run 43717317549](https://github.com/signalco-io/uier/actions/runs/43717317549)
succeeded. Live verification on **15 November 2026** identified
`2a487d8af28ffd236fd052ee3fe68d0e155b20e3`, a descendant containing that merge. The manifest has
48 static pages; the sitemap has 49 public URLs including `/status`. All 49 pages, their canonicals,
advertised social images and 57 internal-link targets passed HTTP checks. These establish
publication/discovery output, not Google indexing or search performance.

The [2 November setup record](development.md#search-indexing) documents verified Search Console
ownership, successful sitemap submission and homepage indexing at that time. There is no current
authenticated Search Console report/export in this task's evidence, and the available connectors do
not provide Search Console access. Current indexed-route counts, non-brand impressions, clicks and
CTR are **unavailable**, not zero. Account access itself has not been disproved.

| Page group | Published URLs in this snapshot | Indexed URLs | Non-brand impressions / clicks / CTR |
| --- | --- | --- | --- |
| Comparisons, including the hub and matrix | 8 | Unavailable | Unavailable |
| Use cases | 3 | Unavailable | Unavailable |
| Integrations, including the hub | 6 | Unavailable | Unavailable |
| Guides, including the hub | 12 | Unavailable | Unavailable |

These counts include the 11 newly published routes. Their actual publication date is now recorded;
a source commit alone did not start their observation window. Hosted WordPress/Webflow/Shopify
acceptance remains pending, separately from these public-page checks.

## Capture the current report

The owner, or an already authorized Search Console user, performs these steps without changing
tracking or introducing credentials into the repository:

1. Open the `sc-domain:uier.io` property. Record the report date, available **complete** date range,
   search type, filters, and current sitemap status. Inspect representative canonical URLs in each
   group; record the distinction between submitted, discovered and indexed.
2. Export page-level and query/page performance for the same period. Group canonical paths by
   `/compare`, `/use-cases`, `/integrations` and `/guides`. Keep homepage performance separate.
   Treat `uier` brand queries separately, recording the exact brand filter used; retain vendor-name
   queries when evaluating comparison intent.
3. Report impressions and clicks with weighted CTR (`total clicks / total impressions`), not the
   mean of row CTRs. Zero is valid only when an actual report establishes it. Mark absent data or
   a suppressed query as unavailable. Query-filtered totals can differ from page totals.
4. Record only aggregate counts and public canonical page groups in this baseline. Do not commit
   raw query exports, account information, private review URLs, comments, images or credentials.

[Google's report guidance](https://support.google.com/webmasters/answer/17011364) explains complete
versus preliminary data and aggregation differences. Check the report’s unavailable markers before
interpreting an exported zero: Google notes that unavailable values can be exported as zero. The
[Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
returns top rows and does not guarantee every row; an export must not be described as exhaustive.
An existing authorized API workflow may be used, but this task creates no OAuth application or keys.

## Compare after a full 28-day window

After a batch is actually published, choose 28 complete reporting days after that date, and compare
with the preceding 28 complete days when available. Record the exact dates and any missing/prelaunch
period. Do not shorten the window and call it a 28-day comparison. A page with a later publication
date gets its own coverage note. No full-window result is available in this record.

For each group, record both periods' impressions/clicks/CTR, changes and the data's limits. Review
query/page overlap: two pages matching a query is a prompt to check their intent and usefulness,
not proof that one should be deleted. Name each resulting action, its owner and supporting evidence;
keep pages with distinct useful intent. Low-volume or unavailable data does not establish a winner.

| Required review entry | Current result |
| --- | --- |
| Actual publication date/revision of the new batch | 15 November 2026; `2a487d8a`, containing merge `d3046ee6` |
| Baseline complete dates, property and filters | Pending authorized report |
| First and preceding complete 28-day windows | Pending full window and authorized report |
| Page/query overlap and editorial actions | Pending actual comparison |

This is a manual owner handoff. It creates no recurring automation and does not delay accurate publication.

## First useful activation and attribution limits

First useful activation means a project receives its first real, saved feedback through a working
review installation: the embed or an authenticated supported extension. A sign-in, project creation,
installation check, draft or synthetic test comment alone is not activation. Extension review does
not establish that the site's script is installed.

Project/comment records can support an authorized aggregate operational count, with a defined period,
deduplicated projects and explicit exclusions for test/public-demo/internal projects. This task has
not queried production records or produced such a count. Current usage totals are not a reliable
first-real-review measurement without those exclusions and a verified installation boundary.

Acquisition-page-to-activation attribution is **unsupported**: analytics remain disabled and the
existing records do not connect a marketing page/query to a later real review. Do not join private
review URLs or infer individual paths from timestamps. Search Console clicks and project feedback
counts are separate aggregate observations, not a conversion rate or causal attribution.

Any future attribution instrumentation needs separate scope and an owner decision about collection,
privacy, provider and cost. It is not required to publish this content and is not enabled here.

## Maintenance

The [public inventory](public-page-inventory.md) already names the maintainer and requires quarterly
competitor reviews plus reviews on relevant releases. New vendors get their actual checked date;
adding them does not renew older vendors' evidence. Keep legal-owner review for changed legal wording,
client/provider qualification and hosted-platform acceptance independent from editorial publication.

Issue #311 remains open for the authenticated baseline and completed 28-day comparison. This runbook
and an explicit unavailable-data record do not fabricate that future result.
