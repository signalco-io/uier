# Comparison pages

`/compare` is the visual workflow chooser. `/compare/website-feedback-tools` compares all seven tools;
`/compare/bugherd`, `/compare/marker-io`, `/compare/usersnap`, `/compare/pastel`, `/compare/userback`
and `/compare/ruttl` give each alternative
its own decision, feature matrix, switching tradeoffs, setup, integration scope, pricing model and
official sources. Unknown slugs return 404.

`src/components/marketing/comparisons/content.ts` is the claim ledger: supported, limited,
unsupported or unverified, with a detail and source per documented competitor capability. Its
`reviewed` records a date and its readable label per product, printed beside that product's source
list. It is the actual source-review date, not a build date or the date another vendor was added.
BugHerd, Marker.io and Usersnap were checked on 11 November 2026. The review dates are
15 November 2026 for uier, Userback and ruttl and 19 November 2026 for Pastel. Update a product's date only after reviewing
its sources. These pages are written by uier and say they compare
documented capabilities rather than a hands-on benchmark: that note sits in each page's "Sources
and scope" section, not under the hero actions, and the `/compare` hub (no sources section) does not
repeat it. Do not infer missing competitor
features from documentation silence or turn an unverified entry into a negative. Preserve plan,
browser and capture-mode caveats. Do not count coming-soon features as available or claim MCP
is exclusive to uier. Link current pricing matrices instead of copying volatile price amounts.

Pastel's [HTML upload guide](https://help.usepastel.com/en/articles/17629923-get-feedback-on-html-files-upload-directly-from-your-ai-agent)
documents single files and folders or ZIPs with bundled assets. An agent can upload a revision to the same
canvas using the CLI or MCP. The [MCP reference](https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server)
documents its permissions and comment tools. The ledger distinguishes an uploaded prototype from a live website URL.

uier's claims follow the shipped feature pages, `docs/review-workflow.md`, the reproduction
allowlist and screenshot/recording policies. Short screen recordings have explicit browser,
permission, size and duration limits; built-in capture has no audio and ends on full-page navigation.
The ledger marks them available and keeps those limits in the detail text.
Keep the limits on replay, console/network capture, surveys, task due dates and release-wide
approval visible. Up to 30 workspace statuses, with project overrides, refine the five categories
Open, In progress, Ready to verify, Done and Archive, while guest actions
retain their category permissions. Project search covers the authorized scope with paged results;
the former 1,000-recent-thread cap does not apply. Bulk operations still affect at most 50 shown
threads. In-browser checks cover the reviewed page. No competitor-history importer is provided.
Change these entries with the product.

## File review and approval scope

The release copy marks file proofing limited to formats enabled by project. The protected preview
qualified member and guest image review, selected Figma frame import and rename resync, MP4 video,
and an EML upload across two versions. A Figma resync keeps the review link and the existing thread
retains its original version and location. The [file viewer](proof-viewer.md) and
[format settings](proof-api.md#format-settings-and-processing) document those contracts.

Preview recorded two independent whole-version approvals and a separate fix verification on an
existing thread. The matrix has separate rows for
[version approval](proof-api.md#version-approvals-and-review-record) and
[per-thread fix verification](fix-verification.md). Fix verification needs project opt-in and a
request on the thread. An approval round may have a deadline, while tasks have no due dates.
A new file version starts with fresh approval decisions.

Publish this copy after the corresponding workflows deploy, following the
[release plan](../../../docs/design/file-design-proofing.md#release-and-verification). PDF and HTML
proof review and real SMTP ingress still need hosted qualification. Keep the email claim scoped to
EML upload. The broader proofing claim requires all six formats and live ingress qualification.

The approval row points to official sources that distinguish actual decisions from version history
and task status. BugHerd documents asset versions in beta. Marker.io documents an issue review status.
ruttl documents page and image approval. Those sources do not establish per-version file decisions.
Pastel documents decisions tied to individual canvas versions.

## Website editing and capture scope

The CSS and text demonstration row describes a single-element preview and exact original and proposed
values for implementation in source. The linked pinned-comments page explains how to use it. ruttl's
website projects support edit mode, and the current web app project FAQ excludes it. Pastel documents
on-canvas text previews and copying edited text. BugHerd documents replacement text in a pinned task.
Keep CSS previews for Pastel, on-page previews for BugHerd, and on-page editing for Marker.io, Usersnap
and Userback unverified based on the linked sources. These editing and annotation sources were checked
on 19 November 2026. For a review of one capability, set `reviewed` on its individual source entries
and retain the general product review dates.

Current uier context states capture attempts,
optional omission and member-only device details; saved original/reply images do not imply automatic
masking before upload. Drawings and recordings follow their current export and permission rules.

`ComparisonPages.tsx` renders the hub, full matrix and pairwise pages using the existing public
page building blocks. `WorkflowPicture.tsx` draws conceptual workflow illustrations from brand
tokens, not competitor screenshots or replicas. Each picture is decorative; the nearby visible
text carries the meaning. `ComparisonCover.tsx` is each pairwise page's cover, beside the header on
wide screens and under it on narrow ones, as on the browser extension page: uier's `<Mark />` and the
alternative's official logo on bordered tiles over a dot grid, each with its name under it. The
logos in `public/compare` are unchanged copies of what the vendors publish: Marker.io's colour
symbol from marker.io/brand, and the square site icons bugherd.com, usersnap.com and
usepastel.com serve. The new icons are unchanged downloads linked by the vendors' own homepages:
[Userback](https://userback.io/favicon.png) and [ruttl](https://www.ruttl.com/icon-color.png), retrieved
15 November 2026. The source SHA-256 hashes are `6c7c27a59569669963bf4c09cb369056fa09b085a979f5c25b527d7024a9fcd2`
(Userback, 32 × 32) and `f523ff0e0a09370bea364a1df78d78dc598b94a9b8545e1efa885f6d49dce2ea`
(ruttl, 168 × 168). Replace a file only with the vendor's own newer asset; never recolour, redraw
or crop one. Feature tables have proper headers, a keyboard-focusable horizontal
scroll region and text labels for all status icons. Keep that scroll region positioned and bounded
(`relative min-w-0 max-w-full`), so absolutely positioned screen-reader labels stay inside it rather
than extending the document. The fixed-layout wide matrix uses native disclosure
elements for the detailed caveats and sources, retaining those details in the server HTML.

The routes are statically generated, each with distinct canonical metadata and a social card.
Each concrete route has a thin page and social-card entry, with copy from the shared claim ledger.
Sitemap and IndexNow generation discover these public routes.
Navigation, footer, landing, client-review guide, triage and integrations link into the section;
the comparisons link back to the relevant shipped features and setup guides.
The new pages include distinct fictional examples, link client feedback, bug reporting and manual
acceptance review, and every pair links the public MCP setup guide. MCP is not exclusive to uier,
and connecting a client does not automatically change code or establish human approval.

## Userback and ruttl source review

The 15 November 2026 review used the official product, help, integration, MCP and pricing URLs in
each product's `sources`. This is documented capability research, not authenticated acceptance of a
competitor account or a performance benchmark.

- Userback distinguishes video feedback, widget-enabled feedback replay and the separate full-session
  replay offering. Plans bundle sites and seats; the free tier's seven-day feedback availability is
  stated. The pricing source places MCP from Team, and diagnostics, feedback replay, surveys and
  project-management integrations from Business. Its MCP reference documents OAuth, existing workspace
  permissions and explicit read/comment/assignment/workflow tools. Keep plan claims tied to the pricing
  source, with no copied currency amount or assumption that all destinations sync every field.
- ruttl documents URL-based site reviews and guest links separately from script-installed web-app
  review. Its product pages also cover image/PDF feedback and task organization. Its MCP page documents
  reading/resolving feedback and client setup.
  Accessibility/SEO entries are marked coming soon, so the ledger does not count them as available.
  Pricing cards and the detailed table disagree on some free user/guest allowances; the copy states
  that conflict and links the current source instead of choosing an unsupported exact entitlement.
- Silence in checked sources stays unverified, including browser/OS metadata capture and several
  capture/approval capabilities. Do not infer absence or promise private-site compatibility from a
  generic live-site claim. Test the chosen installation and login flow before recommending a switch.

`e2e/comparison-pages.spec.ts` covers disclosure interactions, sources, honest gaps, navigation,
responsive width and accessibility. The shared SEO and social-card API suites cover generated
HTML, sitemap inclusion and actual card PNGs. The public-footer suite includes all eight pages.
Focused comparison coverage also guards general and scope-specific source-review dates, CSS and text
claims, current custom-status/paging claims, limited file proofing, distinct approval and verification
rows, distinct examples, ruttl's announced checks and pricing conflicts, and the shared MCP limits.
