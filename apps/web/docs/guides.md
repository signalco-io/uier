# Guides

`/guides` lists the guides; each guide is its own page under it: `/guides/client-website-reviews`,
`/guides/nextjs`, `/guides/html`, `/guides/react`, `/guides/wordpress`, `/guides/webflow`,
`/guides/shopify`, `/guides/mcp`, `/guides/browser-extension`, `/guides/website-review-checklist` and
`/guides/website-bug-report-template`. Their titles, descriptions and paths are in
`src/lib/guides.ts` (metadata, social cards and the tests read them there). Metadata, the sitemap and
the cards follow [search indexing](search-indexing.md) and [social cards](social-cards.md).

## Layout

Guides are visual and scannable: numbered steps with a picture each, short copy. The building blocks
are in `src/components/marketing/guides/`; use them only for the guides, and keep guide-only parts
there rather than in the shared marketing components.

- `GuideHeader`: a link back to `/guides`, the title, the description and the actions, with the
  outline beside them ("In this guide": every step and section, linked to its id). Its column
  aligns children to the start, so an action passed directly (a lone `Button`) keeps its own width
  instead of stretching across the column; `PageHeader` on the other public pages does the same.
- `GuideSteps` and `GuideStep`: the numbered steps on a rail. Each step is a `section` with its `id`
  and an `h2` (`${id}-title`), like `PageSection`, so tests find it as a region by its title. A small
  picture goes in `aside` (beside the step on wide screens), a wide one under the text. On small
  screens the number sits above the heading and the content takes the full width.
- Reference sections after the steps (troubleshooting, headers, help) use `PageSection`, so they
  read differently from the steps.
- `Tips` are titled cells with an outlined icon (Lucide, 1.75 stroke), in a panel of hairlines like
  `Panel`. `CodeWindow` shows a code example with its file name and marks the lines to add; its text
  stays the snippet exactly.
- `GuideTeaser` is a card on the index: picture, label, the title as the card's only link, the
  description.

Each guide keeps its `sections` object (id, title, number) in its page, and the outline is made from
it. Keep existing ids when a section is renamed (the client guide's first step keeps
`prepare-the-review`); links elsewhere may use them.

## Pictures

`GuideSpecimens` draws the pictures from the tokens, like the landing's specimens: never
screenshots, hidden from assistive technologies, the landing's imaginary restaurant site as the
example. Each copies the shipped control it shows, and its comment names it: the app's Site
addresses, install guide tabs and Copy the script, Who can comment (`projectAccessLabels`), review
links (`?toolbar-code=`), Check installation, the toolbar pill (`ToolbarIllustration`), New comment
with its screenshot toggle, and the extension popup's states. Recheck them when those change. The
client guide also reuses `PinnedSpecimen`, `BoardSpecimen` and `FixVerificationSpecimen` unchanged.
Highlights in pictures are neutral (ink outline, muted fill); blue stays for a commented text range,
a commented area, unread and links (BRAND.md).

Keep the pictures' text out of what the tests look up: no second `pre code` on the Next.js guide, no
element whose text is exactly a label the extension test finds (Omit screenshot, the Firefox notice,
the store button's label), and no list items in the extension guide's install section other than the
three steps.

## Copy

Every fact comes from the shipped product: the app's labels, `src/lib/extension/release.ts` for the
extension (see [browser extension](browser-extension.md)), `nextJsSnippet` for the Next.js example.
Shorten rather than add. A step is a title and one or two short sentences.

The checklist scopes a human review, includes content/layout/responsive/interaction/accessibility
checks and a fictional filled example, and separates Pass/Finding/Not checked from certification.
The report template records expected/actual behavior, steps, page/environment, available context and
checked evidence; it promises no replay/console/network diagnostics. The client guide's added brief
and review-round sections retain earlier anchor ids and distinguish team practice from mandatory
workflow or site-level approval. Examples are fictional and contain no real customer data.

`src/lib/guides/reviewResources.ts` owns the reusable text. `CopyableGuideText` adds only an explicit
clipboard write to server-rendered `CodeWindow` children, never reads the clipboard, announces success
and selects/focuses the visible preformatted text when copying fails. It uses the public UI-kit Button.
`PracticalReviewSpecimens` draws static decorative notes, not scores or invented diagnostics.
Keep setup and handoff claims synchronized with [review workflow](../../../docs/review-workflow.md),
[feedback export](../../../docs/feedback-context.md), current checks/triage/verification pages and
dated integration qualification. New practical content does not add a blogging engine or analytics.

## Platform installation guides

`PlatformInstallGuide` renders the five HTML/React/WordPress/Webflow/Shopify guides on the server.
`src/lib/guides/installations.ts` owns their distinct requirements, script placement, publication,
navigation, surface limits, removal, troubleshooting and first-party sources. Its checked date is a
real source review on 15 November 2026, not a build date or hosted-platform acceptance receipt.
`embedScript` and `cspSnippet` from `src/lib/app/integration.ts` generate both default/pinned
examples and the full CSP additions, just as they do in the app. Keep that source shared.

- HTML covers each static page/shared template. React uses the HTML entry, outside the React
  root, once per document. The repository's React adapter exists but is not published to npm;
  the public setup requires no invented package install. Route unmount does not uninstall a script.
- WordPress distinguishes self-hosted/theme/footer-hook access from WordPress.com's plugin-enabled
  plan and activated-hosting restrictions. A content block is not automatically a site-wide install;
  block themes do not necessarily expose `footer.php`. No native uier plugin is claimed.
- Webflow records eligible plans/roles, Footer code and the separate publish step. Staging and custom
  domains are separate origins. Enterprise custom-header controls do not imply every site has them.
- Shopify covers the chosen Online Store theme's `layout/theme.liquid`, access/backup/paid-theme
  constraints and publication. Checkout, customer accounts, the editor and alternate layouts are
  separate surfaces; no native Shopify app or blanket coverage is claimed.
- The small loader and bounded background member check can run for ordinary visitors. The review
  UI opens for a review link or automatically for authenticated project members when background
  authentication works. Project settings still authorize all feedback. The app's installation copy
  and its six language catalogs use that same distinction.
- CSP lists are additions to an existing policy, including media/`blob:` and any configured upload
  origin. Styles are constructed, fonts come from uier, and existing app nonces/sources stay. Copy the
  current per-project list rather than treating a static example as a complete host policy.
- Removal means deleting the source snippet, publishing and clearing relevant HTML caches, then
  checking a fresh document. It does not unload an already running tab or delete saved comments.

## Installation acceptance boundaries

`installation-guides.spec.ts` uses `support/guideInstallationSite.ts` for two actual local sites:
plain HTML and a bundled React app with client-side routing. Both use the maintained footer embed
and strict generated CSP against the real local review API. Coverage checks the installation
handshake, saved first feedback, reload, navigation and return, source removal on a fresh document,
no toolbar requests after removal, and feedback retained in the app. HTML exercises a pinned/SRI
embed; React exercises the default embed and proves navigation keeps the same document. These are
local contract tests, not hosted WordPress/Webflow/Shopify acceptance.

Existing `project-review.spec.ts`, `embed.spec.ts`, `page-state.spec.ts` and `installation.spec.ts`
remain the broader project/origin/SRI/CSP/React-adapter/navigation/diagnosis coverage. The published
Next.js guide uses the maintained `nextJsSnippet`; do not relabel those shared fixtures as a new
hosted Next.js/WordPress receipt or repeat an old pass as fresh verification.

Hosted WordPress, Webflow and Shopify installation/removal acceptance remains **pending** until
the owner supplies representative site access. Record the actual platform/version or plan, theme,
reviewed surface, deployed snippet/build and first-feedback/reload/navigation/check/removal outcomes
in #294/#305. Keep account access and publication HTTP/metadata checks separate. The owner chose
to continue with local checks while leaving hosted acceptance pending; the guides include no claim
that their availability establishes platform qualification.

Focused verification after the shared production build:

```bash
PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test e2e/installation-guides.spec.ts --project="Desktop Chrome" --project="Mobile Chrome" --retries=0
```

## Tests

The MCP setup guide is distinct from the AI feature overview. Its client and plugin blocks come
from `mcp/clients.ts`, shared with Account; `guides/mcp.ts` owns metadata. Keep its first-read,
operations, original/reply-image access, host-dependent read-only card, token/header troubleshooting
and revocation guidance with the maintained MCP/plugin references. `mcp-guide.spec.ts` checks
configuration parity, internal links, responsive layout and accessibility. Public documentation
does not qualify another client's OAuth flow or start monitoring.

`e2e/guides.spec.ts` follows the index to the Next.js guide and on to the client guide, checks the
snippet, the outline links, the back link and accessibility of every guide. `browser-extension.spec.ts`
checks the extension guide's sections, labels and problems; `seo.api.spec.ts`,
`social-cards.api.spec.ts` and `footer.spec.ts` include the guide paths.
`installation-guides.spec.ts` checks every new guide's outline, shared snippets, platform limits,
source links, narrow layout and light/dark accessibility, plus the local lifecycle flows above.
