# Public page inventory and ownership

Accountable content maintainer: [AleksandarDev](https://github.com/AleksandarDev), the repository
maintainer. Contributors update this inventory and the relevant area note in the same PR as a page.
The maintainer reviews product and competitor claims; changed legal wording additionally needs the
owner review required by [#289](https://github.com/signalco-io/uier/issues/289).

Inventory and source paths checked: **12 November 2026**. This is an editorial inventory review,
not renewed hosted product/provider acceptance or a competitor research date. Vendor claims retain
the actual `checkedOn` in the comparison ledger (11 November 2026). Legal corrections in this batch
are proposed wording until owner review, merge and deployment. P1/P2 express delivery order, not
measured search volume. “Published” means the route already exists; it does not waive a correction.

## Published routes

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
| `/guides/browser-extension` | Set up a supported released extension | P1 | Guide catalog; [extension release record](browser-extension.md) | New browser claims need their own acceptance |
| `/browser-extension` | Evaluate reviewing without a script embed | P1 | `BrowserExtension`; release source and extension record | Preserve per-browser store/hosted gates |
| `/compare` | Choose which feedback workflow to evaluate | P1 | `Compare`; comparison ledger and [comparison note](../apps/web/docs/comparison-pages.md) | None; no links to unpublished tools |
| `/compare/website-feedback-tools` | Compare documented capabilities across tools | P1 | `KnownPageLinks.comparison`; comparison ledger | Dated first-party source review |
| `/compare/bugherd` | Evaluate uier against BugHerd's workflow | P1 | `KnownPageLinks.comparison('bugherd')`; comparison ledger | Dated first-party source review |
| `/compare/marker-io` | Evaluate capture and developer handoff differences | P1 | `KnownPageLinks.comparison('marker-io')`; comparison ledger | Dated first-party source review |
| `/compare/usersnap` | Distinguish page review from broader product feedback | P2 | `KnownPageLinks.comparison('usersnap')`; comparison ledger | Dated first-party source review |
| `/compare/pastel` | Distinguish live-page review from asset proofing | P2 | `KnownPageLinks.comparison('pastel')`; comparison ledger | Dated first-party source review |
| `/features/ai` | Evaluate feedback access for coding agents | P1 | `Ai`; [MCP reference](mcp.md), current qualified client setup | #299 site-hosted reference/crosslinks |
| `/features/feedback-triage` | Search, prioritize and act on selected feedback | P1 | `FeedbackTriage`; [triage note](../apps/web/docs/triage.md) | Preserve current bounds and permissions |
| `/features/fix-verification` | Ask a reviewer to check one thread's fix | P1 | `FixVerification`; [verification note](../apps/web/docs/fix-verification.md) | Preserve optional confirmation versus ordinary Done |
| `/features/page-checks` | Understand in-browser accessibility/SEO checks | P1 | `PageChecks`; [checks note](../apps/web/docs/page-checks.md) | No certification or scheduled-crawler claim |
| `/integrations` | Choose a supported feedback destination | P1 | `Integrations`; integration catalog, [activation](integration-activation.md) | Maintain dated availability/acceptance records |
| `/integrations/github` | Set up the GitHub issue handoff | P1 | `KnownPageLinks.integration('github')`; catalog and activation/publication records | Marketplace approval is separate |
| `/integrations/linear` | Set up the Linear issue handoff | P1 | `KnownPageLinks.integration('linear')`; catalog and activation/publication records | Directory eligibility is separate |
| `/integrations/notion` | Set up the Notion page handoff | P1 | `KnownPageLinks.integration('notion')`; catalog and activation/publication records | Submission is not approval |
| `/integrations/slack` | Configure bounded notifications and optional replies | P1 | `KnownPageLinks.integration('slack')`; catalog and activation/publication records | Optional reply acceptance and Marketplace gates |
| `/integrations/azure-devops` | Understand the Azure Boards handoff and setup | P1 | `KnownPageLinks.integration('azure-devops')`; catalog and dated Entra record | Delegated hosted acceptance remains separate |
| `/security` | Inspect actual controls and report a vulnerability | P1 | `Security`; [security note](../apps/web/docs/security-and-open-source-pages.md), [SECURITY.md](../SECURITY.md) | #290 corrections, current evidence for stronger claims |
| `/open-source` | Understand licenses and contribute | P1 | `OpenSource`; package manifests, LICENSE and CONTRIBUTING | License changes need source reconciliation |
| `/brand` | Use the product's actual design system | P2 | `Brand`; [BRAND.md](../packages/brand/BRAND.md) and tokens | Brand changes must update both references |
| `/status` | Check current service health | P1 | `Status`; [status note](../apps/web/docs/status-page.md) | Dynamic health; no uptime guarantee |
| `/legal/terms-of-service` | Understand service/use responsibilities | P1 | `LegalTermsOfService`; [legal note](../apps/web/docs/legal-documents.md), product access/retention code | #289, owner review of changed wording |
| `/legal/privacy-policy` | Understand collection, sharing and retention | P1 | `LegalPrivacyPolicy`; legal note and source-backed feature disclosures | #289, owner review of changed wording |
| `/legal/cookie-policy` | Understand cookies and browser storage | P1 | `LegalCookiePolicy`; cookie names and toolbar storage/session code | #289, owner review of changed wording |
| `/legal/acceptable-use-policy` | Understand acceptable service use | P1 | `LegalAcceptableUsePolicy`; legal document and product scope | Owner review for changed legal wording |
| `/legal/sla` | Understand the absence of service commitments | P1 | `LegalSla`; legal note and verified backup scope | No invented uptime/recovery guarantees |

## Planned content, excluded from discovery until published

These are issue-owned intentions, not live links or reserved routes. A new route enters KnownPages,
the appropriate catalog, sitemap and navigation only when its useful content and release gates are
ready. Unknown/unpublished slugs must return a real 404. Do not create `/docs` aliases for shipped
`/guides` pages or a second `/features/mcp` overview.

| Intended path | Distinct intent | Priority | Owner issue and source | Publication gate |
| --- | --- | --- | --- | --- |
| `/guides/wordpress` | WordPress placement and installation | P1 | #294; shared snippets, current WordPress docs | Representative installation/removal evidence |
| `/guides/mcp` | Complete MCP setup/reference | P1 | #299; maintained MCP reference and qualified clients | Tested setup blocks and privacy/permission limits |
| `/use-cases/client-feedback` | Evaluate collecting client feedback | P1 | #298; client guide and current review workflow | Distinct scenario/limits, not a duplicate guide |
| `/use-cases/bug-reporting` | Evaluate reproducible visual bug handoff | P1 | #298; feedback context and integration contracts | Honest capture/diagnostics limits |
| `/compare/userback` | Evaluate Userback's distinct workflow | P2 | #301; existing comparison structure | Current first-party feature/pricing/MCP evidence |
| `/compare/ruttl` | Evaluate ruttl's distinct workflow | P2 | #302; existing comparison structure | Current first-party feature/pricing/agent evidence |
| `/use-cases/website-annotation` | Evaluate live-page annotation | P2 | #303; anchor/capture contracts | No general file proofing or live-editing claim |
| `/use-cases/user-acceptance-testing` | Plan manual acceptance review | P2 | #303; optional verification workflow | No automated-testing or mandatory approval promise |
| `/guides/html`, `/guides/react` | Stack-specific installation | P2 | #304; maintained app snippets | Representative lifecycle/removal evidence |
| `/guides/webflow`, `/guides/shopify` | Platform-specific installation | P2 | #305; app snippets and current platform docs | Actual plan/surface/placement constraints and acceptance |

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
   least quarterly. The current comparison review of 11 November 2026 is due by **11 February 2027**,
   sooner if a source or product changes. Update `checkedOn` only after a real source review; never
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
