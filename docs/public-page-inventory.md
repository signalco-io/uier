# Public page inventory and ownership

Accountable content maintainer: [AleksandarDev](https://github.com/AleksandarDev), the repository
maintainer. Contributors update this inventory and the relevant area note in the same PR as a page.
The maintainer reviews product and competitor claims; changed legal wording additionally needs the
owner review required by [#289](https://github.com/signalco-io/uier/issues/289).

Inventory and production publication verified: **15 November 2026**. [PR #794](https://github.com/signalco-io/uier/pull/794)
merged as `d3046ee6`; the live manifest identifies `2a487d8af28ffd236fd052ee3fe68d0e155b20e3`, which
contains that merge. [Production Deploy run 43717317549](https://github.com/signalco-io/uier/actions/runs/43717317549)
succeeded. Vercel deployment `dpl_GW6XLikJTxcX6vp53m49ADHL9tLw` is READY for the production project
and owns the `uier.io` alias.

Live crawler checks passed for all **49 public pages and 49 advertised 1200 × 630 social images**,
including all 11 new routes. Canonicals, titles/descriptions, substantive new-page HTML, sitemap and
manifest membership, 57 internal-link targets, both new official-logo assets and seven real unknown-route
404s passed. The manifest contains 48 static pages; the sitemap additionally contains `/status`.
These checks do not establish hosted platform/client acceptance, authenticated product behavior or
Google indexing. Existing vendors keep their 11 November source review; Userback/ruttl and current
uier claims keep their actual 15 November review. P1/P2 express delivery order, not measured volume.

## Canonical routes and implementation gates

Paths integrate with [KnownPages/KnownPageLinks](../apps/web/src/knownPages.ts). Guide metadata is in
the [guide catalog](../apps/web/src/lib/guides.ts); pairwise claims and dates are in the
[comparison ledger](../apps/web/src/components/marketing/comparisons/content.ts). Provider pages use
the [integration catalog](../apps/web/src/lib/integrations/catalog.ts). Every row has the maintainer
above and the inventory review date above; the last column records additional claim/publication gates.

| Canonical path | Primary intent | Priority | Route registration and maintained source | Remaining gate |
| --- | --- | --- | --- | --- |
| `/` | Website feedback and first product evaluation | P1 | `Landing`; [landing note](../apps/web/docs/landing-page.md), brand constants | Maintain search/social title consistency and dated provider qualification |
| `/guides` | Find a practical setup/review guide | P1 | `Guides`; guide catalog and [guides note](../apps/web/docs/guides.md) | None; reuse this hub |
| `/guides/client-website-reviews` | Run a scoped client review through handoff and a checked fix | P1 | `ClientReviewGuide`; guide catalog, review brief and shipped labels | Preserve optional per-thread verification limits |
| `/guides/website-review-checklist` | Scope and perform a human website review | P2 | `ReviewChecklist`; guide catalog, reviewResources.ts and current checks workflow | No certification or security-audit claim |
| `/guides/website-bug-report-template` | Write a reproducible report and hand it off | P2 | `BugReportTemplate`; reviewResources.ts and Copy issue contract | No invented diagnostics; checked example/privacy scope |
| `/guides/nextjs` | Install in a Next.js App Router site | P1 | `NextJsGuide`; shared `nextJsSnippet`, [onboarding](../apps/web/docs/onboarding.md) | #294 remaining platform/removal receipts |
| `/guides/wordpress` | WordPress front-end installation and removal | P1 | `WordPressGuide`; guide catalog, shared embed/CSP and platform data | Published; actual WordPress/Next.js platform receipts remain #294 |
| `/guides/html` | Shared HTML-template installation and removal | P2 | `HtmlGuide`; guide catalog, shared embed/CSP and platform data | Local HTML installation, saved-feedback, navigation and removal verified |
| `/guides/react` | One installation through a React HTML entry | P2 | `ReactGuide`; guide catalog, shared embed/CSP and SPA contract | Local React lifecycle verified; no public npm package claim |
| `/guides/webflow` | Webflow Footer code, plans, roles and publication | P2 | `WebflowGuide`; shared platform data and official source review | Hosted acceptance remains #305; local checks approved |
| `/guides/shopify` | Online Store theme-layout installation | P2 | `ShopifyGuide`; shared platform data and official source review | Hosted acceptance remains #305; no checkout/editor promise |
| `/guides/mcp` | Connect an offered coding client and read one thread | P1 | `McpGuide`; shared client/plugin commands and MCP reference | Client OAuth/host qualification remains separate |
| `/guides/browser-extension` | Set up a supported released extension | P1 | Guide catalog; [extension release record](browser-extension.md) | New browser claims need their own acceptance |
| `/browser-extension` | Evaluate reviewing without a script embed | P1 | `BrowserExtension`; release source and extension record | Preserve per-browser store/hosted gates |
| `/compare` | Choose which feedback workflow to evaluate | P1 | `Compare`; comparison ledger and [comparison note](../apps/web/docs/comparison-pages.md) | None; no links to unpublished tools |
| `/compare/website-feedback-tools` | Compare documented capabilities across tools | P1 | `KnownPageLinks.comparison`; comparison ledger | Dated first-party source review |
| `/compare/bugherd` | Evaluate uier against BugHerd's workflow | P1 | `KnownPageLinks.comparison('bugherd')`; comparison ledger | Dated first-party source review |
| `/compare/marker-io` | Evaluate capture and developer handoff differences | P1 | `KnownPageLinks.comparison('marker-io')`; comparison ledger | Dated first-party source review |
| `/compare/usersnap` | Distinguish page review from broader product feedback | P2 | `KnownPageLinks.comparison('usersnap')`; comparison ledger | Dated first-party source review |
| `/compare/pastel` | Distinguish live-page review from asset proofing | P2 | `KnownPageLinks.comparison('pastel')`; comparison ledger | Dated first-party source review |
| `/compare/userback` | Product-team diagnostics, feedback and agent workflow fit | P2 | `KnownPageLinks.comparison('userback')`; sourced ledger dated 15 November | Maintain tier-specific entitlements and dated source reviews |
| `/compare/ruttl` | Agency visual-editing demonstrations versus anchored discussion | P2 | `KnownPageLinks.comparison('ruttl')`; sourced ledger dated 15 November | Contested free allowances remain omitted; dated source reviews |
| `/use-cases/client-feedback` | Evaluate a client website review round | P1 | `ClientFeedback`; use-case catalog, current review brief/access rules | Fictional scenario; preserve current access rules |
| `/use-cases/bug-reporting` | Prepare reproducible visual bug handoff | P1 | `BugReporting`; use-case catalog, current capture/integration contracts | Explicit recording differs from automatic replay |
| `/use-cases/user-acceptance-testing` | Plan a manual acceptance round | P2 | `UserAcceptanceTesting`; use-case catalog, project opt-in and verification rules | No automated testing or release approval |
| `/features/pinned-comments` | Understand live-page annotation and anchor recovery | P1 | `PinnedComments`; feature-page and toolbar anchor/drawing notes | Delivered in #766; canonical annotation page, no duplicate route |
| `/features/screenshots` | Understand chosen capture, device context and recording limits | P1 | `Screenshots`; screenshot/recording/device contracts | Delivered in #766; preserve saved-image redaction and video limits |
| `/features/threads` | Discuss a finding and share selected attachments | P1 | `Threads`; comment/reply and notification contracts | Delivered in #766; actual visibility and message limits |
| `/features/inbox` | Find page feedback, drafts and unread work | P1 | `Inbox`; toolbar inbox and environment contracts | Delivered in #766; preserve authorized paged scope |
| `/features/board` | Move feedback through the project’s statuses | P1 | `Board`; status categories, settings and board rules | Delivered in #766; project opt-in applies to verification |
| `/features/ai` | Evaluate feedback access for coding agents | P1 | `Ai`; [MCP reference](mcp.md), current qualified client setup | Maintain /guides/mcp setup links and actual client qualification |
| `/features/feedback-triage` | Search, prioritize and act on selected feedback | P1 | `FeedbackTriage`; [triage note](../apps/web/docs/triage.md) | Preserve current bounds and permissions |
| `/features/fix-verification` | Ask a reviewer to check one thread's fix | P1 | `FixVerification`; [verification note](../apps/web/docs/fix-verification.md) | Preserve optional confirmation versus ordinary Done |
| `/features/page-checks` | Understand in-browser accessibility/SEO checks | P1 | `PageChecks`; [checks note](../apps/web/docs/page-checks.md) | No certification or scheduled-crawler claim |
| `/integrations` | Choose a feedback destination, connect a coding tool or build a custom integration | P1 | `Integrations`, integration catalog, [activation](integration-activation.md), `McpGuide`, `DeveloperApi` | Maintain dated availability/acceptance records |
| `/developers/api` | Authenticate and try a project-scoped REST call | P1 | `DeveloperApi`, [REST contract](api.md#public-rest-api-for-custom-integrations) | Keep the downloadable OpenAPI document aligned with the handlers |
| `/integrations/github` | Set up the GitHub issue handoff | P1 | `KnownPageLinks.integration('github')`; catalog and activation/publication records | Marketplace approval is separate |
| `/integrations/linear` | Set up the Linear issue handoff | P1 | `KnownPageLinks.integration('linear')`; catalog and activation/publication records | Directory eligibility is separate |
| `/integrations/notion` | Set up the Notion page handoff | P1 | `KnownPageLinks.integration('notion')`; catalog and activation/publication records | Submission is not approval |
| `/integrations/slack` | Configure bounded notifications and optional replies | P1 | `KnownPageLinks.integration('slack')`; catalog and activation/publication records | Optional reply acceptance and Marketplace gates |
| `/integrations/azure-devops` | Understand the Azure Boards handoff and setup | P1 | `KnownPageLinks.integration('azure-devops')`; catalog and dated Entra record | Delegated hosted acceptance remains separate |
| `/security` | Inspect actual controls and report a vulnerability | P1 | `Security`; [security note](../apps/web/docs/security-and-open-source-pages.md), [SECURITY.md](../SECURITY.md) | Corrections delivered in #664; current evidence for stronger claims |
| `/open-source` | Understand licenses and contribute | P1 | `OpenSource`; package manifests, LICENSE and CONTRIBUTING | License changes need source reconciliation |
| `/brand` | Use the product's actual design system | P2 | `Brand`; [BRAND.md](../packages/brand/BRAND.md) and tokens | Brand changes must update both references |
| `/status` | Check current service health | P1 | `Status`; [status note](../apps/web/docs/status-page.md) | Dynamic health; no uptime guarantee |
| `/legal/terms-of-service` | Understand service/use responsibilities | P1 | `LegalTermsOfService`; [legal note](../apps/web/docs/legal-documents.md), product access/retention code | #664 owner-reviewed corrections delivered; owner review for later changes |
| `/legal/privacy-policy` | Understand collection, sharing and retention | P1 | `LegalPrivacyPolicy`; legal note and source-backed feature disclosures | #664 owner-reviewed corrections delivered; owner review for later changes |
| `/legal/cookie-policy` | Understand cookies and browser storage | P1 | `LegalCookiePolicy`; cookie names and toolbar storage/session code | #664 owner-reviewed corrections delivered; owner review for later changes |
| `/legal/acceptable-use-policy` | Understand acceptable service use | P1 | `LegalAcceptableUsePolicy`; legal document and product scope | Owner review for changed legal wording |
| `/legal/sla` | Understand the absence of service commitments | P1 | `LegalSla`; legal note and verified backup scope | No invented uptime/recovery guarantees |

The bug-report guide links to GitHub and Linear at the handoff step, and the client-review guide
links to Slack during triage. The AI feature page uses [PR #809](https://github.com/signalco-io/uier/pull/809)
as its worked example. Provider guides serve their catalog content in the initial visible HTML.

## Canonical choices and pending acceptance

All acquisition/setup routes from #294/#298/#299/#301–#305 are now published and verified.
Remaining gates are actual WordPress/Next.js receipts in #294, Webflow/Shopify receipts in #305
and authorized Search Console/full-window measurement in #311. User-approved local checks do not
substitute for hosted WordPress, Webflow or Shopify acceptance. The relevant
installation guide note records those boundaries. Measurement and its unavailable-data record live in
[the dated baseline](search-baseline-2026-11-15.md); #311 still owns the actual 28-day comparison.

Preserve `/features/pinned-comments` as the annotation canonical and
`/use-cases/user-acceptance-testing` as the single manual UAT route. Do not add the obsolete planned
`/features/website-annotation`, `/use-cases/website-annotation` or `/use-cases/website-uat` alternatives.
Use `/guides/mcp`, with no duplicate `/features/mcp` overview or `/docs` hub. Unknown alternatives
remain real 404s. Only meaningful canonical content enters discovery; account/project/review URLs do not.

## Registration and maintenance procedure

1. Choose one primary intent and canonical route. Link the owner issue and maintained product/vendor
   source here; record unresolved gates instead of turning planned features into checkmarks.
2. Use `publicPageMetadata` and a route-specific social card. Register the route in KnownPages or its
   parameterized helper and the relevant guide/comparison/provider catalog. Reuse the existing
   static rendering and `next-sitemap` pipeline; do not introduce a second sitemap/robots system.
3. Add useful contextual navigation and include the route in SEO, social-card, footer and accessible
   page coverage. Check clean query canonicals, actual initial HTML, real unknown-route 404s and the
   exact advertised image URL as a crawler. No orphan, placeholder or thin keyword-swapped pages.
4. After merge, verify the deployed revision, live page, links, metadata, sitemap and image before
   marking publication done. Product/provider acceptance receipts remain independent from HTTP checks.
5. Recheck factual claims on a relevant product/provider release and competitor claims/pricing at
   least quarterly. The existing vendors’ 11 November review is due by **11 February 2027**; the new vendors’
   15 November review is due by **15 February 2027**, sooner if a source or product changes. Update `checkedOn` only after a real source review; never
   use a build time as a content date. Record the review and resulting edits in the PR/issue.

The maintainer owns the manual review handoff tracked by #311. No recurring automation is created.
Search Console setup is not a non-brand traffic baseline or a full 28-day result. Record the actual
available period and missing data in #311, then compare a full 28-day window once available. Keep
analytics collection disabled; new attribution instrumentation needs its own scoped work.

## Non-content routes

Account/project/review-link/consent/invitation routes, notifications, APIs, verification/session
bridges, extension demos, the manifest and image assets are not acquisition content. Preserve their
noindex/exclusions and authorization. Robots.txt must allow fetching a page's noindex directive;
it never grants or protects data access. Status is sitemap-eligible, but changing live health is
excluded from IndexNow editorial notifications. See [search indexing](../apps/web/docs/search-indexing.md).
