# Comparison pages

`/compare` is the visual workflow chooser. `/compare/website-feedback-tools` compares all five tools;
`/compare/bugherd`, `/compare/marker-io`, `/compare/usersnap` and `/compare/pastel` give each alternative
its own decision, feature matrix, switching tradeoffs, setup, integration scope, pricing model and
official sources. Unknown slugs return 404.

`src/components/marketing/comparisons/content.ts` is the claim ledger: supported, limited,
unsupported or unverified, with a detail and source per documented competitor capability. Its
`checkedOn` is the date the vendor sources were actually reviewed, not a build date. Update the
date only after rechecking those sources. These pages are written by uier and say they compare
documented capabilities rather than a hands-on benchmark. Do not infer missing competitor
features from documentation silence or turn an unverified entry into a negative. Preserve plan,
browser and capture-mode caveats. Do not count coming-soon features as available or claim MCP
is exclusive to uier. Link current pricing matrices instead of copying volatile price amounts.

uier's claims follow the shipped feature pages, `docs/review-workflow.md`, the reproduction
allowlist and screenshot policy. Keep its absent recording, replay, console/network capture,
file proofing, surveys and custom workflow capabilities visible. Image attachments do not imply
asset proofing, in-browser checks do not imply scheduled site crawling, and per-thread reviewer
confirmation does not approve an entire asset version or release. No competitor-history importer
is provided. Change these entries with the product.

`ComparisonPages.tsx` renders the hub, full matrix and pairwise pages using the existing public
page building blocks. `WorkflowPicture.tsx` draws conceptual workflow illustrations from brand
tokens, not competitor screenshots or replicas. Each picture is decorative; the nearby visible
text carries the meaning. Feature tables have proper headers, a keyboard-focusable horizontal
scroll region and text labels for all status icons. The wide matrix uses native disclosure
elements for the detailed caveats and sources, retaining those details in the server HTML.

The routes are statically generated, each with distinct canonical metadata and a social card.
Each concrete route has a thin page and social-card entry, with copy from the shared claim ledger.
Sitemap and IndexNow generation discover these public routes.
Navigation, footer, landing, client-review guide, triage and integrations link into the section;
the comparisons link back to the relevant shipped features and setup guides.

`e2e/comparison-pages.spec.ts` covers disclosure interactions, sources, honest gaps, navigation,
responsive width and accessibility. The shared SEO and social-card API suites cover generated
HTML, sitemap inclusion and actual card PNGs. The public-footer suite includes all six pages.
