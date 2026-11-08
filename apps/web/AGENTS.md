# apps/web - agent guide

The uier.io website and comments API. Next.js 16 App Router, React 19 (React Compiler on),
Tailwind CSS v4 with the signalco minimal theme preset, deployed to Vercel. Runs on
http://localhost:4004 with `pnpm dev` from the repository root.

## Layout

| Path | What |
| --- | --- |
| `app/layout.tsx` | root layout: Geist via `next/font` (`geist` package), metadata and viewport from `@uier/brand`; app and marketing layouts own providers |
| `app/global.css` | Tailwind + UI kit theme + **`@uier/brand/tokens.css`** + shadcn's state variants (`src/styles/shadcn.css`) + `@theme` font and sidebar colour mapping |
| `app/(rest)/(marketing)/` | public pages: `page.tsx` (landing), `brand/page.tsx` (living brand page), `legal/*` (legal documents), `security/page.tsx`, `open-source/page.tsx`, `status/page.tsx`, `features/<feature>/` (one shipped workflow per page, each with its own social card: `ai`, `feedback-triage`, `fix-verification`), `browser-extension/` (the published desktop extension; its setup guide is `guides/browser-extension/`), `layout.tsx` (nav with the section links and Sign in to `/app`, container, footer, clearance for the toolbar) |
| `app/(rest)/(app)/app/` | the app (`/app`): `(auth)/` sign-in, invitation, first-run (`welcome/`) and browser extension sign-in pages (one card), `(shell)/` signed-in pages in the sidebar layout (projects, a project's comments, its settings and install guide, My work, the workspace area `workspace/` with users, teams, clients and settings, account), `connect/` a coding tool's OAuth consent and its public error page (one centred card), `review/[projectId]` review links |
| `src/lib/app/` | app logic: `store.ts` (Cosmos `app` container / in-memory), `model.ts` (documents), `session.ts`, `signIn.ts`, `google/` and `microsoft/` (OIDC sign-in), `passkeys.ts` (passkey sign-in), `avatars.ts` (profile pictures; `avatarLimits.ts` is safe for the browser), `context.ts` (user, workspace, role), `projects.ts`, `projectDeletion.ts` (deleting a project and its records), `invitations.ts` (invitations, removing members), `integration.ts` (embed snippets, CSP sources) |
| `src/lib/integrations/` | shared synchronization: source signals/tombstones, bounded discovery, independent leased delivery, provider registry, encrypted credentials/OAuth/grants and member-only link projection; distinct from embed `integration.ts` |
| `src/components/ui/` | the app's [shadcn/ui](https://ui.shadcn.com) components (Base UI, `base-vega` style, `components.json`), source we own |
| `src/components/app/` | app UI: `PageHeader` (`media` sits left of the title and description together: a project's favicon, a person's avatar)/`Section` (titled cards), `PersonAvatar` (a person's picture with their initial as fallback), `LinkTabs`, `SettingsLayout` (sectioned settings: a project's, the account), forms and server actions per area (`projects/`, `clients/`, `comments/`, `users/`, `teams/`, `workspace/`: the workspace area's tabs, `shell/`: sidebar, workspace switcher, account menu, breadcrumbs) |
| `src/lib/comments/submissions.ts` | create/reply receipts: actor/partition scoped, 30-day TTL, content conflicts, atomic Cosmos batch with the write; no text/image in receipts |
| `src/lib/review/`, `app/api/review/` | the review API of a project's toolbar: reviewers (`actor.ts`), project comments and their permissions (`comments.ts`), CORS for the project's sites (`http.ts`), BotID proofs (`verification.ts`), routes |
| `app/review-verification/` | empty, frameable BotID bridge; validates the parent origin on the server and returns a five-minute proof bound to origin, project and reviewer; only this and the session bridge can be framed |
| `app/review-session/`, `app/api/review/[projectId]/sso/` | empty frame and same-origin cookie endpoint for background member sign-in; validate the actual message parent origin against project addresses and recheck membership. Only accepts the separate `review-sso` cookie purpose, never the app cookie; no CORS, no cache, no storage-access prompts |
| `src/lib/email/` | email through Azure Communication Services and the templates |
| `proxy.ts` | exact-path page security headers, request nonces and signed-out `/app/*` redirects (`?next=`) |
| `app/api/comments/route.ts` | comments API (Cosmos DB through `src/lib/db` and `src/lib/repo`) |
| `app/api/mcp/`, `src/lib/mcp/` | the MCP connector: authentication (`credentials.ts`), tools (`server.ts`), prompts, event webhooks (`events/`), client setup blocks ([MCP connector](#authenticated-mcp-connector)) |
| `instrumentation.ts` | runs once per Node.js server: registers Next.js `after()` for library code (MCP event delivery after a change), so `src/lib` never imports `next/server` |
| `app/api/oauth/`, `src/lib/mcp/oauth/` | uier's OAuth authorization server for `/api/mcp` only: authorize, token, register, revoke and the metadata routes that `next.config.ts` rewrites from `/.well-known/`; consent is `/app/connect/<requestId>` |
| `app/api/status/route.ts`, `src/lib/status/` | live service checks for `/status` and monitors ([status reference](../../docs/operations.md#status)) |
| `app/api/visitor/route.ts` | the anonymous visitor: guest name (`GET`) and sign out (`DELETE`) |
| `app/api/rewrite/route.ts`, `src/lib/rewrite/` | AI rewrite suggestions for selected text (Anthropic SDK; `503` without `ANTHROPIC_API_KEY`; the e2e tests use `e2e/support/anthropicStub.ts`) |
| `app/manifest.ts`, `app/opengraph-image.tsx` | web manifest and the brand social card, generated from brand constants |
| `src/lib/social/`, `app/og/[card]/route.ts` | social cards: `pageCardImage` for a public page's `opengraph-image.tsx`, and the static cards of app links ([social cards](#social-cards-and-link-previews)) |
| `app/not-found.tsx`, `app/(rest)/error.tsx` | the 404 page and the error boundary, both a `StatusPage` (`src/components/StatusPage.tsx`: logo, a browser frame with a pin on the empty spot, what happened, where to go) |
| `src/components/marketing/` | `ContentPage` (the building blocks of every public page, landing included: header with a one-sentence lead, section heading, section (heading beside its content on wide screens, like the landing's questions; `wide` stacks them, for the brand page's specimens), `Panel` of hairline-divided cells with `Tile`, `CheckList`, `InlineLink`), `HowItWorks` (the landing's cover: one animated loop on the example site from adding the script tag to a thread marked as done, under a row with its heading, a caption and Pause), `LandingSpecimens` (static, `aria-hidden` pictures of the review layer and the app for the landing's feature tiles; example content is an imaginary restaurant site, a different part of it than the walkthrough shows), `LandingPricing`, `LandingFaq`, `SiteFooter` (the footer of every public page; `Footer1` vendored from signalco renders it), `ReviewThreadDemo` (a visual specimen on `/brand`; the landing thread is live) |
| `src/components/legal/` | `LegalDocument`: legal navigation, title, effective date and the text styles of every legal page |
| `src/components/brand/` | client helpers for the brand page (`ThemeToggle`, `TokenSwatch`, `ToolbarIllustration`) |
| `src/knownPages.ts` | every route the site links to; add new pages here |
| `src/lib/secureHeaders.ts`, `proxy.ts`, `next.config.ts` | page CSP in proxy, one-year HSTS with subdomains, Permissions-Policy, COOP and X-XSS-Protection: 0; BotID keeps a restrictive same-origin CSP |
| `e2e/` | Playwright tests (landing, brand page, headers, axe accessibility, the toolbar on another origin) |
| `public/` | icons rendered by `pnpm -C packages/brand icons`, `favicon.svg` copied from `packages/brand/assets` |

## Styling rules

- Browser support is the latest two stable major releases of Chrome, Edge, Firefox, Safari and
  iOS Safari, declared in the root `.browserslistrc`. Next.js and the toolbar share that policy.
  Turborepo tracks it as a global dependency. UI-kit Tailwind compatibility and shadow-root fixes
  remain necessary within this browser range; they are not legacy-browser polyfills.
- Use the UI kit's semantic utilities: `bg-background`, `text-foreground`, `text-muted-foreground`,
  `text-secondary-foreground`, `border-border` (`border` alone), `bg-muted`, `bg-primary`.
  Brand-only tokens are `hsl(var(--brand-accent))`, `--brand-accent-text`, `--brand-selection`,
  `--brand-success`, `--brand-warning`. No raw hex in components (the two dark/light logo panels
  on the brand page are the deliberate exception: they must stay black and white in both themes;
  so are the sign-in card's Google "G" and Microsoft logo, in their own colours on the shared outline button, and
  `IntegrationLogo`, the provider logos on the Integrations pages: GitHub, Linear and Notion draw in the text colour,
  Slack and Azure DevOps keep their own colours, as each provider's guidelines ask).
- Radius: `rounded-sm` 6, `rounded-md` 8, `rounded-lg` 10, `rounded-xl` 12, `rounded-2xl` 16,
  `rounded-3xl` 24, `rounded-full`. Borders over shadows; only floating surfaces get the shadow
  from `BRAND.md`.
- Fonts: `font-sans` is Geist, `font-mono` is Geist Mono (variables set on `<html>`). Weights
  400/500/600 only.
- Logo: `<Logo />` from `@uier/brand/Logo` (nav, footer), `<Mark />`, `<Pin />`. The pin is the
  only filled icon; everything else is a 1.75-stroke outline.
- `@uier/brand` is TypeScript source; it is in `transpilePackages` in `next.config.ts` and in a
  `@source` line in `global.css` so Tailwind sees its class names.

## The brand page (`/brand`)

It is the live reference for the brand and must keep rendering from `@uier/brand` and the UI
kit (no screenshots, no copied values). When you add a brand token, component style or asset,
add it to the page in the matching section. `e2e/brand.spec.ts` checks that the page renders,
that the assets (favicon, icons, manifest, OG image) are served, and that it passes axe.

## Landing page

Copy and structure follow `BRAND.md`, "Marketing and metadata": the tagline is the `h1`, the
review layer is shown with persisted starter threads (the toolbar renders their pins and highlights), one solid
"Get started" and one outlined secondary action, no badges above the headline. The cover beside the
headline is the how-it-works scene (`HowItWorks`), and the description stays a direct child of the
hero's first column (tests select it as `main>section>div>p`). "Try it on this page" points visitors
to the real toolbar; it does not embed a thread.

Sections, in order, each with an `h2` whose id the navigation and footer link to (`KnownPages`):
how it works (`#how-it-works`, the small heading over the cover scene), features (`#features`), get
started (`#get-started`), pricing (`#pricing`, `LandingPricing`) and questions (`#faq`,
`LandingFaq`, native `<details>`).

- **Only what uier does today.** Every step, feature and answer describes behaviour that ships: in
  the toolbar (check `packages/toolbar`) or in the app's projects (check `src/lib`) before adding
  one. Say which parts can be tried on the page itself: the showcase is a guest, so mentions,
  assignment, environments and the MCP connector only work in a project. The showcase runs on
  every public marketing page and its inbox includes other public pages. Project embeds work on
  their configured addresses, with headers for identity and BotID proofs for writes.
- **Pictures are specimens.** The cover scene and the feature tiles are built from the tokens and
  `<Pin />` (`HowItWorks`, `LandingSpecimens`), hidden from assistive technologies, never
  screenshots; keep their text out of the strings the e2e tests look up on the page (the FAQ's
  "add one script tag to your site", the description). The starter thread "Try it here" is pinned
  to the "Try it on this page" box by `id="first-step-comment-anchor"`; the id is stored in
  production, so keep it.
- **One section moves.** The how-it-works scene is a timeline of phases (`phases` in
  `HowItWorks.tsx`); everything in it is always rendered and shown or hidden with the brand's fade,
  and the pointer's targets are measured from the scene, so it follows any width. It plays only
  while in view, Pause stops it, and with reduced motion it shows one still frame. Its canvas is
  `data-uier-decorative` with a `min-height`: the toolbar's screenshots keep its box but not its
  content (copying it made every capture on the landing page much slower). The e2e axe scan skips
  the scene (`data-landing-scene`): it is a picture, and a frame caught mid-fade has low contrast. Keep the other sections still, and keep each section's layout
  different from its neighbours.
- **Get started** (the hero and pricing) opens `/app`, like the navigation's "Sign in": signed-out
  visitors land on sign in, signed-in people in the app. The `#get-started` section below the
  features still offers both paths: trying the showcase toolbar on this page, or a project for
  your own site.
- **Pricing** is `brand.pricing`, word for word, and one free offering: no prices, tiers, trials
  or limits. The app has no billing page while everything is free.

`e2e/landing.spec.ts` asserts the title, the `h1`, the "Get started" links, the sections, the
pricing copy, the FAQ keyboard behaviour and the footer line through the brand constants; update
the test when you change those on purpose.

## Integration pages

Public `/integrations` and `/integrations/[provider]` pages use the shared marketing building
blocks and `src/lib/integrations/catalog.ts` for actual provider capabilities, features, configurable
settings and setup steps. The catalog's `features` also render on the project's page for the provider
in the app (`IntegrationFeatures`, with On/Off for two-way status sync and reply sync) and its optional
ones as badges on the app's Integrations cards and chips on the public index. Keep `two-way-status` and
`reply-sync` aligned with the adapters' `supportsStatusSync`/`supportsReplySync`; `e2e/integrations.api.spec.ts`
checks them. Both index pages show `IntegrationLogo`. "Suggest an integration" (`SuggestIntegrationButton`
on the public index, `SuggestIntegration` in the app) calls `openToolbarFeedback()` from `ToolbarScript.tsx`,
which opens uier's own toolbar feedback form: public on the showcase, private on app pages.
Listing illustrations come from `scripts/render-integration-listings.mjs`, existing brand vectors
and Geist fonts. They contain no customer data and are labelled illustrations. Keep permissions,
privacy limits and directory status aligned with the adapters and `docs/integration-publication.md`.
`e2e/integration-pages.spec.ts` covers the public guides, their features and settings, the logos, the suggestion
form, support/setup links and accessibility.

## Search indexing

The public `/guides` index links the client review, Next.js and browser extension setup guides. Use the existing
`ContentPage` components, snippet generator, metadata and social-card helpers; add public routes
to SEO, card and footer checks. `SiteStructuredData` connects the homepage `WebSite` to its actual
signalco publisher. Preserve the homepage Bing verification meta tag after setup.
`search-index.mjs` generates the public static-page manifest after the sitemap; the production
workflow submits only its changed public URLs through IndexNow. See
[search discovery](../../docs/search-discovery.md) for safeguards and recovery.

Public pages use `publicPageMetadata` (`src/lib/metadata.ts`) with their own pathname, title and
description. Canonicals and Open Graph URLs point to the production URL without query parameters;
never put a homepage canonical in the root layout, where other pages would inherit it.
`next-sitemap.config.cjs` excludes app flows, notification preferences, empty verification bridges
and metadata assets. Add public dynamic pages through `additionalPaths` (currently `/status`).
Do not emit build times as `lastmod`; use real content modification dates if they become available.

App pages, notification preferences and verification/session bridges declare `noindex`. Keep them
crawlable in `robots.txt` so search engines can read that directive; authentication protects app
data. `e2e/seo.api.spec.ts` checks generated HTML, the sitemap and these crawl directives. See
[search indexing](../../docs/development.md#search-indexing) for checks and Search Console context.

## Social cards and link previews

Every link to uier.io unfurls with its own title, description and 1200 × 630 card (BRAND.md,
"Marketing and metadata"). The root layout sets no Open Graph title, description or URL, so pages
outside `publicPageMetadata` fall back to their own.

- **A public page** draws its card in an `opengraph-image.tsx` next to its `page.tsx`, with the same
  title and description as its metadata (`legal/sla/opengraph-image.tsx` is the pattern):

  ```tsx
  const card: PageCard = { section: 'Legal', title: 'Service level agreement', description: '...', path: '/legal/sla' };
  export const alt = pageCardAlt(card);
  export const size = socialCardSize;
  export const contentType = socialCardContentType;
  export default function Image() { return pageCardImage(card); }
  ```

  `section` is an optional label top right; an integration passes `provider` for its logo instead.
  Next adds the file to the page's Open Graph and X tags because `publicPageMetadata` sets no
  `images` (and suffixes its address inside route groups). A page without a title is the landing
  page and gets the brand card; the root file is not inherited once a page sets its own Open Graph.
- **App links** are previewed signed out, so a comment, review or project link ends at sign in
  (`?next=`) and an invitation at its page. `describeAppLink` names the kind of link and, for review
  links, the site's host from the link's own `url`; it reads nothing from the store, so a preview
  never shows a comment, project, workspace or person. The browser tab keeps "Sign in".
- Cards draw no text from a request: `/og/[card]` prerenders `linkCards` and 404s anything else.
  Pictures are specimens with placeholder bars, never words that read as someone's content.
  The sitemap excludes `*/opengraph-image*` and `/og/*`.

`e2e/social-cards.api.spec.ts` checks every public page's card and the app link previews; add a new
public page to its `publicPaths` (and to `e2e/seo.api.spec.ts`).

## Feature pages

`/features/<feature>` pages describe one shipped workflow each, with the shared marketing building
blocks, a static specimen built from the tokens (`TriageSpecimen`, `FixVerificationSpecimen`, `AiSpecimens`),
`publicPageMetadata` with their own path and a page card with the section Features
([social cards](#social-cards-and-link-previews)). Page-level questions use `FaqPanel` from `LandingFaq`.
There is no `/features` index; any other slug is a real 404. Publish a feature page only once the
workflow is deployed to production, with labels and actor rules taken from the delivered controls,
link it from the landing (details or questions) and the footer, and add it to `KnownPages` and to
the public paths in `e2e/seo.api.spec.ts`, `e2e/social-cards.api.spec.ts` and `e2e/footer.spec.ts`.

`/features/feedback-triage` states the shipped bounds from `MAX_PROJECT_COMMENTS` (1,000 threads)
and `MAX_TRIAGE_THREADS` (50), the batch outcomes and the permissions; change the page with them.
Its bulk Done is ordinary completion and never reviewer confirmation: a pending check ends as "Done
without reviewer confirmation" (`@uier/toolbar/verification` labels). It links to
`/features/fix-verification` for the verification workflow rather than describing it.
`e2e/feature-pages.api.spec.ts` covers its metadata, social card and the 404s;
`e2e/feature-pages.spec.ts` its claims, links and accessibility.

`/features/fix-verification` keeps a reviewer's confirmation apart from ordinary and bulk Done (it
links to the triage page for the latter), a connected service's closure and MCP status; change it
with the verification controls and `src/lib/review/fixVerification.ts`.
`e2e/fix-verification-page.spec.ts` covers its copy, links, responsive layout and accessibility.

`/features/ai` covers the MCP connector for coding tools and rewrite suggestions. It offers only the
clients Account offers (`mcp/clients.ts`: Claude Code with browser sign-in, Codex and Cursor with an
access token), the operation labels of `components/app/mcp/scopes.ts`, the prompts of
`mcp/workflows.ts` and what the connector cannot do; change it with them and with
[docs/mcp.md](../../docs/mcp.md). Approval of each write happens in the coding tool, never in uier, and
MCP never confirms a fix. Its rewrite section follows the toolbar's labels and the privacy policy's
"Rewrite suggestions". The landing links it from the "Let your coding agent fix it" tile (`AgentSpecimen`),
the rewrite line of the details and the coding-agent question. `e2e/ai-page.spec.ts` covers its copy,
links and accessibility; `e2e/feature-pages.api.spec.ts` its metadata and social card.

## Footer

Every public page gets `SiteFooter` from the marketing layout; pages do not render their own.
Contact and social destinations come from `brand.contact` / `brand.social` in `@uier/brand`
(signalco's addresses and X account: uier has none of its own), routes from `src/knownPages.ts`.
Labels are sentence case. `e2e/footer.spec.ts` checks the footer on every public page and its links.

## Legal documents

`/legal/privacy-policy`, `/legal/terms-of-service`, `/legal/cookie-policy`,
`/legal/acceptable-use-policy` and `/legal/sla` describe what the site actually does: what the
comments API stores, the `__Host-uier_visitor` cookie, rate limits, BotID, Vercel Web Analytics, where data
is stored and for how long. When you change any of that (a new cookie or storage key, a new
third party, a different retention), update the matching document and its effective date in the
same pull request. The SLA states that there are no service commitments; do not add uptime targets
or credits before they are decided. `e2e/legal.spec.ts` checks each document, the legal navigation
and the footer links.

## Page security and cookie migration

`proxy.ts` overwrites incoming CSP and nonce headers and generates 128 random bits per request
for `/app` pages and the exact `/review-verification` bridge. Next applies the forwarded CSP nonce
to framework scripts; the app layout reads `x-nonce` and passes it to `ClientProvider` / `ThemeProvider`.
Those pages render dynamically with `no-store`. The verification bridge has no app/theme/analytics
providers. The fixed `/review-session` script and its SHA-256 source share `review/sessionDocument.ts`.
Only those two exact paths are frameable; case variants get deny/`frame-ancestors 'none'`.

Public pages deliberately retain static rendering and `script-src 'unsafe-inline'`: their generated
Next bootstrap and theme scripts vary by build. We do not apply request nonces to cached HTML.
Keep providers in the marketing/app layouts so a root `headers()` call does not turn the public site
dynamic. Vercel Web Analytics collection is disabled by the owner (3 November 2026); `ClientProvider` does
not inject its SDK. The existing analytics CSP sources remain available for a future explicit setup. Vercel toolbar/frame/Pusher hosts apply only to
`UIER_DEPLOYMENT_ENV=preview` (set at build time). Clipboard permissions are left alone.
COOP is `same-origin` on public pages and `same-origin-allow-popups` across the app, including
`/app/review`: the installation check retains its WindowProxy when the popup redirects cross-origin.
The app needs that policy from its initial document, including sign-in, because client navigation
keeps COOP. `DocumentPolicyBoundary` in `ClientProvider` uses full document navigation for links
crossing between public pages and `/app`, so both CSP and COOP change with the destination.
BotID's custom headers allow same-origin scripts, workers, fetches and framing, with no inline scripts.
`botIdProxy.ts` applies that same policy after fetching the response: Next's external rewrite proxy
discards configured response headers. The local test-only upstream uses the existing API stub.
HSTS is one year with subdomains. Do not add `preload` or submit to the preload list until an owner
has observed this policy operating successfully.

`src/lib/cookieNames.ts` centralizes HTTPS `__Host-` / `__Secure-` names, local HTTP names and
bounded legacy reads. The fixed migration cutoff is 30 October 2026 UTC; legacy sign-in bindings
stop being accepted 15 minutes later, session/SSO cookies after 30 days, visitor/workspace cookies
after 365 days. Never reset this date on a rebuild. Prefer the new name even when its value is
invalid; do not resurrect a legacy identity. New writes use only the chosen current name; sign-out
expires both names so fallback cannot undo it. Remove the migration branches after their deadlines.

## Security and open source pages

`public/.well-known/security.txt` publishes the existing reporting contact and repository policy
using RFC 9116. `next.config.ts` redirects `/security.txt` to that canonical location. Keep its
contact aligned with `brand.contact.security` and `SECURITY.md`, and renew its fixed `Expires`
date before it passes; requests and builds must not silently extend it. `e2e/seo.api.spec.ts`
checks delivery, format, contact, expiry and the redirect. See
[security disclosure discovery](../../docs/operations.md#security-disclosure-discovery).

`/security` lists only controls that are in place and can be checked in this repository; remove a
control from it when it stops being true, and add one only when it ships. `/open-source` mirrors the
licenses in each `package.json`, the root `LICENSE` and the README "License" section. Both have the
repository's `SECURITY.md` and `CONTRIBUTING.md` as counterparts; keep them saying the same thing.
`e2e/pages.spec.ts` checks them.

The security controls distinguish Pulumi deletion protection from Azure management locks and
state that approving reviews are not required. Renovate can automerge only selected development
type/browser-test dependencies after three days. Keep those controls aligned with `renovate.json`,
workflow SHA pins and the current main ruleset; do not claim the pending credential rollout is active.

The continuous-backup control and privacy retention line describe the verified live
`Continuous7Days` policy in West Europe. Keep the seven-day wording aligned with the
[backup evidence](../../docs/backups-and-restore.md) and `e2e/pages.spec.ts` / `e2e/legal.spec.ts`; add no recovery-time, recovery-point,
regional disaster-recovery or uptime commitment. Restore drills and remaining-TTL copy-back are
documented in that runbook.

## Status page

`/status` (dynamic) and `/api/status` render `getServiceStatus()` from `src/lib/status`: only what
those checks measure, at request time. Do not add uptime percentages, history or services that are
not checked. A new service gets a real check there first. `e2e/status.spec.ts` covers both.

## The app

- Toolbar point anchors can use the single `#uier-toolbar>>>` boundary on uier's own pages.
  `comments/validation.ts` retains the restricted CSS grammar after it; the toolbar resolves
  those anchors only when the page and configured API share an origin. `e2e/toolbar-review.spec.ts`
  covers the review UI and `comments.api.spec.ts` rejects arbitrary shadow boundaries/selectors.

- `reviewSsoCookie.ts` owns the HttpOnly/Secure/SameSite=None companion, restricted to `/api/review`.
  Sign-in and first-party app requests seed it with no longer lifetime than the SameSite=Lax app session;
  sign-out expires both. It cannot authenticate app routes. Browser-blocked handoffs silently retain the
  explicit review-link fallback. Comment writes continue to require the existing browser verification.

- **UI: shadcn/ui.** The app (`app/(rest)/(app)`) is built from the components in `src/components/ui`,
  added with `pnpm dlx shadcn@latest add <name>` (run in `apps/web`; the shadcn skill in
  `.claude/skills/shadcn` has the rules: `Field` for forms, `Empty` for empty states, `Badge`, `Item`,
  icons with `data-icon`). After adding a component, check the diff: the CLI may write oklch colour
  variables or a `@theme inline` block into `app/global.css`, which must not land. Colours stay HSL
  triplets in `@uier/brand/tokens.css` (the theme preset wraps them in `hsl()`), so a component that uses
  a raw `var(--x)` as a colour needs `hsl(var(--x))`. Resting surfaces get a border, not a shadow
  (BRAND.md). Icons come from `lucide-react` (1.75 stroke, set in the theme). A person (Users, assignees,
  invites) is `User` / `UserPlus`, a team is `Users`, and your own account is `CircleUser`, in the app and
  the toolbar (`@signalco/ui-icons` `User`, `UserCircle`). Toasts are `sonner`
  (`toast()`), mounted with the tooltip provider in the app layout.
- **Base UI.** The components are on [Base UI](https://base-ui.com) (`base-vega`); a new `shadcn add`
  delivers the Base UI variant. Compose with `render` (`<DialogTrigger render={<Button />}>Open</DialogTrigger>`),
  never `asChild`. A link that looks like a button is the link itself with `buttonVariants`
  (`<Link className={buttonVariants({ variant: 'outline' })}>`): Base UI's `Button` gives a rendered `<a>`
  `role="button"`. `Button` defaults to `type="button"`, so a form's submit button says `type="submit"`.
  Menu items take `onClick` (there is no `onSelect`), `AlertDialogAction` does not close its dialog (close
  it through the dialog's state), a `Select` passes its `{ value, label }` options as `items` so
  `SelectValue` shows the label, toggle-group values are arrays, and focus targets are `initialFocus` /
  `finalFocus` refs. Open triggers carry `data-popup-open`, pressed toggles `data-pressed`, open collapsible
  triggers `data-panel-open`; `src/styles/shadcn.css` maps `data-open`, `data-checked` and the rest to
  Base UI's attributes only. Local changes to keep when re-adding a component: `badge`, `item` and
  `breadcrumb` (Base UI's `useRender`, which needs `useRef`) start with `"use client"` so server pages can
  render them; `buttonVariants` returns `cn()`-merged classes; dialog and alert-dialog backdrops have
  `forceRender` (a dialog opened from the mobile sidebar sheet is nested). In tests, single-choice toggle
  groups are `button`s with `aria-pressed` in a `group` (not radios), Base UI checkboxes are found by role
  (`getByLabel` also matches their hidden input), a tab panel is found by its tab's name (the outgoing
  panel stays mounted while it exits), and a test waits for a menu to finish opening
  (`animationsFinished`) before pressing Escape or opening a submenu in it.
- **Layout.** `(shell)/layout.tsx` is the sidebar (`AppSidebar`: workspace switcher (its menu switches
  workspaces, creates one (`createWorkspaceAction`, a dialog for the name) and, for admins, opens Workspace
  settings), Projects (the projects index; the person's own work goes beside it), active projects with a
  Create project icon link in their header, then at the bottom Workspace (admins; for everyone else only when a
  visible project has a client), Give feedback and the account menu), the inset panel with the breadcrumbs
  (`AppBreadcrumbs`, from the path) and the one invite dialog (`InviteProvider`; `InviteButton` and
  `useInvite()` open it). uier's own workspace, which every account joins for Give feedback, is a
  `feedback` option in the switcher for people who are not its admins: its own entry after Create workspace,
  named "Feedback on uier", never in the list of their workspaces. A project's header is
  `projects/[projectId]/layout.tsx` (the favicon in `PageHeader`'s `media`, beside both the name and the row under it: client, then who can comment, whose popover has Invite for admins, Open
  review and the settings cog (`ProjectSettingsButton`, an icon link with a tooltip, current on the settings pages),
  then the `ProjectTabs`: Comments and Install (Settings → Installation and the onboarding install step) until a comment
  from one of the project's addresses arrives (`hasProjectFeedback`); after that there is nothing to switch between and
  the tabs are gone); its pages render the comments, install guide or settings under it.
- **Workspace area** (`workspace/`): the workspace's name above `LinkTabs` (`workspace/(tabs)/layout.tsx`,
  `workspaceTabs`): Users, Teams, Clients, Activity and Settings for admins, Clients only for everyone else and in
  the uier workspace. `/app/workspace` opens the first tab. A team's and a person's own pages (`workspace/teams/[teamId]`,
  `workspace/users/[userId]`) are outside the `(tabs)` group, with their own header. The old addresses
  (`/app/users`, `/app/teams`, `/app/clients`, `/app/settings` and the team and person pages) redirect there
  (`next.config.ts`). Each page keeps its own authorization: Users, Teams, Activity and Settings are admin-only.
  Activity renders access events as sentences (`teams/activityText.ts`, pure, with names from
  `teams/activityNames.ts`, which also looks up people who left, archived teams and who accepted an
  invitation); never show raw actions, ids or before/after JSON. Users shows its filters only past
  `FILTER_FROM` people and invitations, and only those that tell people apart. The invite dialog
  (`InviteForm`) must fit an 800 px tall screen: role cards side by side, long lists scroll in their box,
  and the relationship label is under More options. It starts with the project it was opened from, or
  the only project (not when opened from a team). It never offers the invitation link where email is
  sent: the link signs in as the invited address.
- **Project settings** are sections, each its own page under `settings/` (`settings/layout.tsx`): General (the
  settings page itself), Review, Environments, Installation, People and teams, Integrations, Notifications and
  Danger zone, listed by `projectSettingsSections` and linked with `KnownPageLinks.projectSettings(id, section)`.
  The layout shows them with `SettingsLayout` (`LinkTabs` `side`: a column beside the section, a row above it on
  small screens) and the breadcrumbs end with the section. `settingsContext.ts` loads the viewer and project once per request;
  admin-only sections call `configurableProject` (404 for commenters and the uier workspace). Commenters see
  Installation and Notifications, and the settings page redirects them to Notifications. Integrations is a grid of
  the services not connected yet (logo, one line, Connect, Details) above the connected ones, each a row with its
  destination and status badge; every service has its own page, `settings/integrations/<provider>`
  (`KnownPageLinks.projectIntegration`), with the provider's section: destination, sync controls and privacy limits.
  `components/app/integrations/projectIntegrations.ts` lists the services and computes the status badges both pages
  show. Connect/callback routes return to the provider's page (`?github=connected`); actions revalidate it and the
  overview (`revalidateIntegration`). The settings tabs keep Integrations current on those pages (`nested`). `install` without
  `?onboarding=1` redirects to Settings → Installation (the toolbar still links there).
- **One save per settings page.** General (name and client), Review (who can comment, the brief and, in a collapsed
  Advanced section, the page state) and Environments (the site addresses table) are each one form in one card
  (`ProjectSettingsForms.tsx`) with one server action (`updateProjectGeneralAction`, `updateProjectReviewAction`,
  `updateProjectSitesAction`) that parses every field with the existing schemas before writing, checks the admin role
  (`adminProject`) and the public project (`assertMutableProject`), and writes only what changed. The card footer is
  `SaveFooter` (`components/app/SettingsSave.tsx`): "Unsaved changes", Discard and a Save that stays off until
  something changed; `useSettingsDraft` compares the draft with the saved values and starts over from the server's
  values after a save. Long cards pass `stickyFooter` to `Section`, so Save stays in reach. Switches save at once
  (project emails, comment excerpts); radios and text wait for Save. Account's Profile uses the same footer.
- **Environments** is one table, `ProjectSitesForm`: each address with its label and the addresses it shares feedback
  with (a group of origins, stored as the environment's `group`; the UI never names groups). `siteRows.ts` holds the pure
  rules (`e2e/site-rows.api.spec.ts`): addresses show without their default scheme (`typedAddress`), addresses on one
  origin follow the first one's label and sharing, sharing goes both ways, groups of one site are dropped, and a group
  keeps the name it was saved with (environment filters link to it) or is named after its first row's label or host.
  The table is a card per address below the `@xl` container width.
- **Notifications** (project settings) has two cards: Email notifications (everyone: their own project emails, a switch;
  commenters also read whether emails carry excerpts) and Email content (admins only: Include comment excerpts, the
  unchanged `updateProjectEmailExcerptsAction`). `setProjectEmailsMutedAction` mutes through `setProjectMuted` and
  revalidates the app; Account → Notifications lists every visible project of the workspace with the same switch.
- **Account** (`account/`) uses the same `SettingsLayout` and `Section` cards: General (the account page
  itself: profile (picture and name), appearance, workspace access, which lists only what is set: role, then relationship and teams when
  there are any, then projects), Sign-in (Google, Microsoft, passkeys, sign out), Notifications (each project's emails)
  and Coding agents, listed by `accountSections` and linked with `KnownPageLinks.account(section)`. Sign-in returns and
  linking outcomes land on Sign-in, and the breadcrumbs end with the section. A change to `SettingsLayout`
  applies to both settings.
- **Profile pictures** (`lib/app/avatars.ts`, [API](../../docs/api.md#profile-pictures)): Account's Profile uploads,
  changes and removes one at once through `POST`/`DELETE /api/account/avatar` (a route, not an action: a
  multipart body, a same-origin `Origin` check, then the session; the page calls `router.refresh()`). The server
  sniffs PNG/JPEG/WebP/GIF, caps 4 MB and 50 MP, and Sharp re-encodes a centre square of at most 256 px as WebP.
  The image is a `user-avatar` document in the user's partition, swapped with `user.avatar` in one `transact`
  batch; never write a user document without its etag, or a stale copy drops the reference. `avatarUrl(user)` gives
  `/api/avatars/<userId>/<version>` (random version, immutable, private cache, any signed-in viewer). Show a person
  with `PersonAvatar` (`name`, `avatarUrl`): the initial stays the fallback. Lists get `avatarUrl` from
  `listMembersWithUsers`; comment views only for current project members; the review API and toolbar have none.
  Google and Microsoft sign-in import the provider's picture on a first sign-in or link, only while the account has
  none (`importProviderAvatar`). `avatars.api.spec.ts` and `account-avatar.spec.ts` cover it.
- The comments page is an inbox. `comments/CommentInbox.tsx` lists compact rows (`CommentRow.tsx`: number,
  first line, author, what it was left on, page path, then priority other than Normal, status other than Open,
  the assignee's avatar, age and the unread dot) beside the open thread (`CommentCard.tsx`). The open thread is
  in the URL (`?comment=<id>`, `useOpenComment`): side by side (`@container/comments` from `@4xl`) it replaces
  the history entry and the first shown thread is open until another is chosen; narrower (a phone) a row opens
  the thread in the list's and the filters' place with Back to comments, and adds a history entry so Back closes
  it. Each row is a link (it opens in a new tab too) with the selection box beside it. The list moves with the
  keyboard like an inbox: ↓/↑ go to the next/previous row and stop at the ends, Home/End (from a row) to the first and
  last; side by side the row's thread opens through the same `open()` as a click, narrower only the focus moves and
  Enter opens it. The keys act from the list, or from the page while nothing has the focus and the caret is not in the
  open thread (it keeps scrolling with them); never from text fields, menus or dialogs, and they leave a key the page
  already handled (`defaultPrevented`). Only the current row's link and selection box are in the Tab order (a roving
  tab stop: the row last focused or opened), so Tab goes on to the thread. `e2e/comment-keyboard.spec.ts` covers it;
  the board keeps plain Tab order. `CommentBoard.tsx` shows
  Open, Ready to verify and Done as compact cards; a card opens its thread in a sheet. Switching List/Board
  closes the open thread. What a thread was left on comes from `lib/app/commentAnchor.ts`: an element in words
  from its saved selector's tag names ("Link in navigation"), an area of one, the selected text, or the whole
  page (no page title is stored).
- The open thread (`comments/CommentCard.tsx`, one `article` named "Comment by ...") keeps the toolbar's words:
  state, `#number` and the unread dot (the Mark as read button, "Unread. Mark as read") on the first line with
  Copy and More actions at its right, on one line at any width. The state badge is the status menu ("Status:
  Open. Change status") with Open, Ready to verify and Done, each enabled by the person's permissions: Ready to
  verify opens the Request verification form (`VerificationControl`, whose submit has the same name), Open from
  Ready to verify cancels the check, and Done there reads Done without verification. Copy is one menu with Copy
  issue (Markdown for an issue or a coding tool; a toast says "Issue copied.", its errors and manual clipboard
  fallback stay in the thread) and Copy link (opens the reviewed page at this comment). Follow thread / Unfollow
  thread and, once read, Mark as unread are in More actions. Then On (what it was left on, with the selector or
  the selected text), Page (the review link, "Open on ...", and the environment's name or why the original
  source is unavailable), Priority and Assignee (a 20px avatar, empty and dashed while unassigned, and the name; a menu for those who can assign), the
  verification, every message, Reply and the quiet Open in .... The first message's time is followed by
  `CommentDevice`: screen size and browser icons whose popover (hover or click, `hoverPopoverTrigger` for Base
  UI's `openOnHover`, like the project header's access info) lists the reproduction context and copies its
  text; the toolbar still shows one device icon with details under the message. Pending actions show `Spinner`.
- `comments/ReplyComposer.tsx` is a lazy inline reply form in List and Board, using shadcn controls
  and pure `@uier/toolbar/drafts` / `mentions` logic only. `replyCommentAction` validates the payload,
  resolves current app authority and forwards trusted request headers to `replyToProjectComment`;
  `commentParticipantsAction` rechecks the thread before returning names/opaque ids without email.
  Replies preserve status and unread state; `CommentUpdates` appends pending messages and action
  revalidation reconciles them. Seven-day drafts are scoped to app origin/deployment, project,
  account and thread. Closing/filtering keeps text; explicit discard, successful send and both
  app sign-out controls clear relevant drafts. Storage failure stays in memory with a notice.
  Never import the toolbar runtime/providers/styles into the app. See `docs/review-workflow.md`.
- `ProjectMark` (project cards, the sidebar, the project header) shows the site's favicon, loaded by the
  browser from the project's main address over HTTPS (`/favicon.ico`, `/favicon.svg`,
  `/apple-touch-icon.png`, no favicon service or server fetch; `proxy.ts` adds `img-src https:` on app
  pages), on a light tile in both themes, with the project's first letter until one loads. The icon keeps
  2 px of padding inside the 16 px tile (larger tiles set their own with `[&>img]:p-*`), so icons drawn
  edge to edge stay clear of the border and the rounded corners.
- The project header's Open review is a menu with Review and Visit site for every address; the header does not
  repeat the addresses. The install guide
  opens from the empty comments list and from Settings → Installation. It shows "Connected" with the latest
  comment's time once a comment came from one of the project's addresses, with the guide behind Show install
  guide. Its parts (`ScriptSnippet`, `PlatformSteps`, `InstallationCheck`) are exported for onboarding. The script
  is the only place the project code shows. Until `extensionDistribution()` says the extension is available, the
  browser extension tab is one line and the setup guide (`BrowserExtensionGuide`).
- **My work** (`/app/my-work`, `lib/app/myWork.ts`, in the sidebar right after Projects) lists what needs the signed-in
  member across the workspace's projects they can see: open threads assigned to them, open threads that mention them
  (`mentionsMe`), then other unread threads; each thread once, in the first group it belongs to, newest first. It
  reads the same authorized snapshot as each project's comments page (`loadProjectComments`) and stores nothing; a
  row opens its thread on its project's page (`?comment=`). `e2e/my-work.spec.ts` covers it.
- The comments' filter bar (`CommentFilters.tsx`): search, one Filter button (a popover with Priority, Environment
  and page, People (Everyone, Assigned to me, Unassigned, Opened by me) and Only unread; its badge counts the
  filters in effect) and List/Board, then the status tabs
  (list only). Each filter in effect shows under the bar with its own clear button ("Clear filter: Unread",
  "Clear author filter: ..."). The list header (`TriageSelection`) has Select shown results, the count with
  the unread count, and Mark all as read; the bulk actions appear only once something is selected.
  `LocationFilter`: environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts`. Choosing an environment
  keeps the panel open and reloads its pages.
- `app/global.css` defines `--radius-sm/md/lg` (the preset's radii are JS values with no variables);
  shadcn's small buttons read `var(--radius-md)`.
- **First run.** A new user (`findOrCreateUserWithStatus`) has `welcomePending`. Email sign-in without `next`
  goes straight to `/app/welcome` (`(auth)/welcome`), and `/app` sends there too while it is set. The step
  suggests a name (`nameFromEmail`) and, for the workspace made for the account (`welcomeWorkspace`; none after an
  invitation), a name from the email's domain unless it is webmail (`src/lib/app/welcome.ts`). Continue validates
  both before saving (`renameWorkspace`, then `finishWelcome` with the name); Skip only clears the flag. Never
  show it to existing accounts (they have no flag) and never rename a workspace the user did not get at sign-up.
  `e2e/support/app.ts` `signIn()` skips it unless `{ welcome: 'stay' }`; `welcome.api.spec.ts` covers the rules.
- **Onboarding.** `OnboardingSteps` shows Your site, Add the script, Check installation and Invite a reviewer;
  once the project exists, every step after the site is a link. `install?onboarding=1` shows one step per
  screen in an `OnboardingStepCard` (`&step=check` is `InstallationCheckStep`, `&step=invite` is
  `InviteReviewerStep`) with Back, Skip setup (to the comments) and Next, Finish on the last step. Keep one
  primary button per step: Next, Check installation until the site is confirmed, Invite for admins of an
  invited-only project. Invited-only projects
  use the shell's `InviteButton` with `projectId`, gated by `context.isAdmin`; the empty comments list does
  the same. Guest projects reuse `GuestReviewLinks` for every configured address in order (main site first),
  in onboarding or the header's access popover (`ProjectAccessInfo`), never again in its empty state. Copy fields use
  plain `reviewUrl` links, never `/app/review`, `uier-token` or `uier-check`. Comments-off states explain that
  comments are off and link admins to Settings → Review; their header popover has no Invite. `inviteAction` still checks the
  admin role on the server. `e2e/app.spec.ts`, `project-review.spec.ts` and `users.spec.ts` cover these paths.
- `app/projectPublicIds.ts` assigns stable 21-character public Nano IDs lazily with claimed references
  and optimistic concurrency. Generated review URLs, embeds and guest email links use `publicId`;
  internal project ids retain storage/membership/MCP meaning. Review routes use `findReviewProject`,
  retaining legacy random codes but rejecting the fixed `uier00000001` code. Do not expose abandoned
  references or overwrite a saved public id. See `docs/api.md#public-project-identifiers`.
- Project deletion (`app/projectDeletion.ts`, the settings Danger zone, `deleteProjectAction`) is admin-only,
  requires the typed name and refuses the public workspace/project in the service too. Disconnect services
  through their own Disconnect paths while the project exists, then store the identifier-only
  `project-deletion` intent before deleting anything. Every step must stay idempotent: the scheduled worker
  (`sweepProjectDeletions`) repeats pending intents and, for a day, the thread/record passes. Retire code and
  public id claims (`project-ref-retired`, `project-public-ref-retired`), never delete them; resolve only live
  claims. Access changes go through `mutateAccess`; members are updated, never deleted or recreated. Threads use
  `deleteProjectThread` + `forgetScreenshot`. A new project-keyed record type must be added to the deletion, the
  privacy policy and [project deletion](../../docs/project-deletion.md); `e2e/project-deletion{,.api}.spec.ts` cover it.
- Project addresses use `normalizeSiteUrl` in `src/lib/app/projects.ts`: schemeless localhost,
  `.localhost` subdomains and loopback IPs default to HTTP, other hosts to HTTPS. Explicit schemes
  and ports are preserved. Review CORS and redirects still require an exact configured origin.
- Clients are workspace documents (`DbClient`: name, description, icon, colour) in the workspace partition;
  projects point to one with `clientId`, and `DbClientName` (`client_name_<sha256>`) keeps names unique. A
  rename is one transaction on the client and its name reservations, so every project follows at once.
  `src/lib/app/clients.ts` owns them: `createProjectWithClient` / `setProjectClient` find or create the
  client by name and rewrite the client document in the same transaction as the project, so `updateClient`
  can delete an unused client (when a rename takes its name) without leaving a project pointing at nothing.
  Older projects have `clientName` only; `ensureProjectClient` moves it to a client on read (in
  `listProjects` and `getProject`, like `ensureProjectPublicId`), and `updateClient` migrates the whole
  workspace first. `projectClientNameSchema` collapses whitespace and clears blank input; the shared limit
  is 80 characters (280 for descriptions). Icons (`clientIcons`, Lucide) and colours (`clientColors`:
  tints of `--brand-accent`, `--brand-success`, `--brand-warning`, `--destructive`; letters stay ink) live
  in `clientAppearance.ts`; `ClientMark` draws the tile. More colours need new brand tokens first.
  Show clients only through visible projects: pages call `listVisibleProjects` first, then `loadClients`,
  and `projectClients` / `clientNames` / `projectClient` keep only clients those projects point to (the
  Clients tab, the sidebar's Workspace link, the suggestions, the filter, cards and the project header). The filter
  value is the client id (`?client=<id>` or `none`); old `name:<name>` links redirect to it. The client
  field (`ClientNameInput`) is free text that suggests existing clients: it is built on
  `src/components/ui/autocomplete.tsx`, Base UI's Autocomplete styled like shadcn's Combobox (shadcn has
  no autocomplete, and Combobox only takes one of its items). Admins edit a client in `ClientEditDialog`
  on the Clients tab (`updateClientAction`) and add one there for chosen projects (`ClientCreateDialog`,
  `createClient`: refuses a name another client with projects uses, in any case, and moves each project to it). Client data belongs to the signed-in app: `reviewProjectDto`
  (the review API's project) and MCP project lists never include it. `e2e/clients.api.spec.ts` covers
  rename, admin-only access, workspace isolation, migration and DTO exclusion; `project-clients.spec.ts`
  and `users.spec.ts` the UI.
- Every server action parses its arguments with zod and checks the session and role itself
  (`appContextOrThrow({ admin })`); pages use `requireAppContext()` / `requireAdminContext()`.
  Positional argument schemas live next to the actions, outside `'use server'` modules; use
  `parseActionInput` for short `UserFacingError` messages before any argument is used. Share
  `app/validation.ts`'s user id schema across mentions and assignment boundaries. Services that
  persist boolean settings validate them again. Never trust ids without loading the document
  from the current workspace.
- Apart from uier's own public feedback project, which every account joins (`joinPublicProject`), a
  membership is only ever created by an invitation or together with a new workspace (`ensureOwnWorkspace`
  or `createWorkspace` from the workspace menu, one `createAll` transaction each; at most
  `MAX_CREATED_WORKSPACES` per creator). Never recreate a missing member document of a customer workspace: a missing
  member is someone an admin removed, and recreating it undoes the removal (their review tokens, MCP access
  tokens and connected apps work again). `e2e/workspaces.api.spec.ts` and the users e2e tests cover it.
  Member removal uses `mutateAccess` / `AppStore.transact` to conditionally update the workspace
  access revision, delete the versioned member, invalidate old invitations and append its event.
  Read the workspace before counting admins and repeat both on a conflict; never undo a removal
  by recreating its member document. `replaceAndDelete` remains available for older callers.
- Forms use `useActionState` with `actionResult()` (expected failures become `{ ok: false, error }`)
  and controlled inputs, so React's reset after an action never drops what was typed.
- Message edits through the review API compare `expectedText` before changing a thread item; author/admin
  permission checks and etag retries preserve concurrent replies. `editedAt` is shown in the toolbar and app.
- Saved image replacements use `POST .../comments/<id>/screenshot` with shared screenshot validation,
  the daily image budget and `expectedRevision`. `replaceScreenshot.ts` checks visibility/edit rights
  on each attempt; stores upload immutable Blob bytes, then atomically swap comment metadata and
  image references under the comment etag. Never delete a proposed blob on an uncertain Cosmos result.
  Never delete the original before this transaction succeeds. Public authors and project authors/admins
  can replace evidence; readers retain the existing comment visibility rules. The screenshot replacement
  API/browser tests cover failure, reload, redaction, private visibility and deletion.
- Reproduction context is allowlisted by `src/lib/comments/reproduction.ts`: only authorized project members
  get it in the review DTO or app cards. Public/guest `device` DTOs stay limited to size and viewport. Capture time
  and viewport belong to the original feedback start; page links validate the project's origin and retain only stored approved page state.
- `@uier/toolbar/page-state` is the shared pure URL contract. Projects opt in through Review → Advanced (`ProjectReviewForm`); the
  review API filters submitted paths using that policy and marks new records `pageStateVersion: 1`. Store queries
  match v1 keys exactly; the legacy query-string prefix fallback must never merge v1 views into a base page.
  `sourcePath` keeps the page's trailing slashes for links: `newSourcePath` stores it only for the same page key,
  and every navigable link (app cards, member redirects, reproduction, notifications, Copy issue) goes through
  `commentSourcePath`, which falls back to the key. Never group, query or authorize by it.
- `InstallationCheck` checks the actual configured site through a nonce/window/origin-bound browser handshake.
  Script/API configuration, comments reads and browser verification must succeed before confirming. Missing evidence
  is inconclusive. Do not replace this with a server fetch/proxy or add test comments. Advanced headers stay in `InstallGuide`.
- `integration.ts` owns default and pinned HTML/Next.js snippets from `@uier/toolbar/bundle`.
  `InstallGuide` offers both with the update/support policy. Constructed review sheets remove
  `unsafe-inline` from its style CSP sources. `scripts/toolbar-assets.mjs` publishes identical
  default/content-addressed loader bytes and the content-addressed review script, checks and retains
  both assets for one year after last release as current; deployment builds carry forward the
  verified uier.io archive. Keep the
  manifest no-store and content-addressed JavaScript immutable with anonymous CORS.
- Links the app sends or redirects to come from `appBaseUrl()` (requests) or its shared pure
  `configuredAppBaseUrl()` helper (scheduled workers), never from an untrusted Host header.
- Sign-in emails contain a link and an eight-digit numeric code, sharing the same 15-minute request and
  atomic delete in `signIn.ts`. The code requires the signed HttpOnly `__Host-uier_sign_in_request` cookie;
  a newer request replaces the binding, and `startSession` clears it. Use `appCookieOptions` for the
  binding (SameSite=Lax, Secure outside local runtime). Store only the request-specific keyed code hash
  and compare in constant time. Never put codes in URLs, subjects or logs. Both atomic guess counters
  start at the request's creation time; reserve before comparing, invalidate on the fifth wrong guess.
  Keep the email budgets (5/address, 20/IP/hour). Invitations remain link-only. All invalid codes share
  one message; a foreign binding spends none of the original request's budget.
- **Google sign-in** (`src/lib/app/google/`, [docs/google-sign-in.md](../../docs/google-sign-in.md)) is a hand-rolled
  OIDC code flow with PKCE. `GET /app/sign-in/google` refuses cross-site and prefetch starts and counts 30 per IP per
  hour; its 10-minute `google-sign-in` record keeps state and nonce hashes (the PKCE verifier is a keyed hash, never
  stored), bound by the signed HttpOnly `__Host-uier_google_sign_in` cookie, and the callback's delete winner alone
  exchanges the code. Never copy the code or state into a URL. The ID token comes straight from the token endpoint,
  so its claims are checked and its signature is not; check the signature first if a token ever arrives another way.
  A linked `sub` signs in (never the email, and the uier email never follows Google); unverified addresses are
  refused; only `@gmail.com` or a matching `hd` finds or creates the account and links at once. Every other
  address, new or existing, first proves its inbox with a browser-bound email code (`googleLinkId` on the sign-in
  request, `google-link` record): never create an account for it from Google alone (stale verification would
  pre-hijack it). Account links (only with a sign-in from the last 10 minutes, the passkeys' `requireRecentSignIn` on
  `sessionSignedInAt`, checked at the start and again at the callback) and unlinks; a `sub` of another user is refused.
  A link (any rule, or Account) brings Google's `picture` to an account without one; `googlePictureUrl` allows only
  `https://*.googleusercontent.com`, and a returning sign-in never imports. The button shows only in
  production and local runtime; endpoint overrides work only locally. `google-sign-in{,.api}.spec.ts` use
  `e2e/support/googleStub.ts`.
- **Microsoft sign-in** (`src/lib/app/microsoft/`, [setup and identity rules](../../docs/microsoft-sign-in.md))
  uses a separate Entra client from Azure Boards, `common` for work/school and personal accounts, and
  only `openid email profile`. Follow the Google flow's PKCE, state/nonce hashes, signed cookie,
  one-use callback, rate limits, safe redirects and recent-session checks for Account linking.
  Verify RS256 signatures, tenant-scoped key issuer, exact v2 issuer/tenant/audience, lifetime and nonce
  with `jose`. Identity is SHA-256(issuer + newline + sub). Never identify a user by Microsoft's
  `email` or `preferred_username`; first sign-in always proves a chosen inbox with the existing email
  code flow. Only the explicit confirmation form attaches the browser's `microsoftLinkId`; a link
  opened in another browser signs in by email and links nothing. A linked identity signs in directly
  and never changes the uier email. Account can link/unlink one Microsoft identity. The callback's access token reads
  Graph's `/me/photo/$value` once (no extra scope) for an account without a picture; a pending link keeps only the
  normalized photo, never the token. Production/local
  only; endpoint overrides are local-only. Tests: `microsoft-sign-in{,.api}.spec.ts`, `microsoftStub.ts`.
- Passkeys (`src/lib/app/passkeys.ts`; `PasskeySignIn` on sign-in, `PasskeysSection` on Account) use
  `@simplewebauthn/server` and `/browser` with the RP ID and origin of `appBaseUrl()` (none on an IP
  address). Challenges are single-use records (5 minutes, atomic delete) bound by the signed HttpOnly
  `__Host-uier_passkey_challenge` cookie; every verification clears it. Adding a passkey needs a session
  signed in within 10 minutes (`iat` in the session token): a stolen older cookie cannot add one.
  The `passkey` document in `user:<id>` is the source of truth; its `passkey:<hash>` lookup is written
  first and deleted last. Keep counter checks, user verification, Ed25519/P-256/RSA only (not ML-DSA)
  and the per-IP limits. The email field has `autocomplete="email webauthn"` for passkey autofill, which
  `PasskeySignIn` starts only once the field shows (`autofill`).
  `e2e/passkeys.api.spec.ts` covers the rules; `passkeys.spec.ts` uses Chromium's virtual authenticator on
  `localhost`, with the autofill stubbed off where a test clicks the button.
- The sign-in card (`sign-in/SignInForm.tsx`, which renders the card itself) lists every option as the same outline `Button size="lg"` with
  only the method's name (Passkey, Google, Microsoft, then Email, the last resort) under "Choose how to sign
  in."; once the email is sent, the card's header becomes "Check your email" (`SignInCodeStep`, a status) and
  the code field is focused. Google and Microsoft linking keep their own header and show the status in the
  card. Each button's `aria-label` is "Sign in with ...", which the tests look up. The email option is a link
  to `?with=email` that opens the email form in place (before hydration it navigates there); "Ask for a new
  email" uses the same URL. `app.spec.ts` checks the order and `e2e/support/app.ts` `openEmailSignIn` opens it.
  `startSession(userId, method)` also sets `__Host-uier_last_sign_in` (the method's name only, one year,
  kept after sign-out); the page reads it with `getLastSignInMethod` and that option's button (`relative`)
  gets `LastUsedBadge` at its right edge and `aria-describedby` pointing at it. An email proof that linked Google or Microsoft
  counts as that provider; invitations count as email. `passkeys.spec.ts` covers it.
- Locally (`UIER_LOCAL=1` or `next dev`) and on previews no email is sent; pages show the link and code.
  The e2e helpers in `e2e/support/app.ts` sign in with the code. `e2e/sign-in.api.spec.ts` covers expiry,
  concurrency, binding validation, code-email safety and lifetime budgets; `app.spec.ts` and
  `project-review.spec.ts` cover browser isolation, accessibility and the toolbar's return path.

## Page and mutation responsiveness

Project comment views mount `RealtimeComments`: native Vercel sockets notify, then refresh the
authorized server snapshot in a transition. `src/lib/realtime` owns origin/viewer-bound tickets,
current authorization and a shared, two-second compact Cosmos metadata source. Never broadcast
comment bodies/ids or bypass private-thread visibility. Keep four-minute connection renewal,
HTTP fallback, draft preservation and the provider boundaries. See [realtime](../../docs/api.md#realtime-comment-changes)
and `e2e/realtime.api.spec.ts` / `e2e/realtime.spec.ts`. `vercel.json` enables Fluid compute.

`projects.ts` and `members.ts` share repeated render reads through React `cache` (metadata,
layouts and pages). `loadWorkspaceAccessForRender` shares the render's team snapshot; mutation
retries must continue to use uncached `loadWorkspaceAccess`. Nothing caches access across requests.
Independent context and comment enrichment reads run together. General settings streams lightweight
usage totals after its authorization check instead of enriching every comment before rendering forms.
Keep authorization/not-found checks outside streaming boundaries so forbidden document requests retain 404.

`ProjectComments` is a client boundary over the server-authorized environment/author snapshot.
Status, people, page, unread and list/board filters use native history and `useSearchParams` with
no server request; environment and author changes still navigate through server authorization.
`commentsQuery.ts` is the shared pure parser. `CommentUpdates` owns optimistic status, assignment,
follow and read changes for cards, counters and board columns. Failed actions revert through
`useOptimistic`; bulk read keeps rendered cursors and partial-failure retry behavior. Actions already
revalidate and return updated RSC data: do not add a second `router.refresh()` after those writes.
`NavigationPending` gives settings links immediate feedback while their authorized destination loads.
`e2e/app-performance.spec.ts` blocks filter round trips and holds mutation responses to verify
immediate updates, rollback, persistence and background feedback submission on desktop and mobile.

## Rewrite accounting

`src/lib/rewrite/suggest.ts` is the shared showcase/project model boundary. Emit exactly one bounded
`rewrite_usage` event per configured service call via `telemetry.ts`; record usage before output is
refused, truncated or rejected. Keep content, identifiers and raw errors out of logs, including SDK
payload logs. Telemetry must not fail a rewrite. `pricing.ts` owns versioned source/date/USD rates;
`report.ts` aggregates UTC daily exports with explicit retry, fallback and missing-usage coverage.
See [rewrite costs](../../docs/rewrite-costs.md) for operations, model evidence, limitations and revert.
`rewrite-accounting.api.spec.ts` and `rewriteFixtures.ts` cover accounting without paid calls. A single
ordinary iteration with a null model may use the serving response model; preserve unknown models and
fallback gaps. Evaluation summaries must never turn an unknown charge into zero. Live
comparison requires a separate explicit bounded command; never put it in automated tests. Preserve
budgets, timeouts, output validation and route response shapes when changing instrumentation or models.

## Testing

Teams use `src/lib/app/access.ts` / `accessRules.ts` for additive, current workspace/project
authorization. Load one workspace team snapshot for list operations; never revive the old
direct-only predicate or copy inherited grants into a member's direct list. All access writes
go through `mutateAccess` and `AppStore.transact` (workspace revision guard + mutation + 180-day
event). Recheck admin/target/team ownership on retries. Member removal and invitation acceptance
use the same guard; acceptance consumes the workspace invitation atomically, not just its lookup
token. Team archive clears projects and invalidates earlier team invitations; restore starts
empty. Keep public-workspace safeguards and guest/private-thread distinctions. New app routes
are `/app/workspace/teams`, `/app/workspace/teams/[teamId]`, `/app/workspace/users/[userId]`. Admin previews must reject stale
revisions. See [teams and access](../../docs/teams-and-access.md) for limits, history, erasure,
Session-consistency limits, real preview Cosmos checks and rollback.

CSP console audits must be asserted before an axe scan. Axe fetches external stylesheets with
`fetch`, which can produce scanner-only `connect-src` violations on a strict reviewed site.
Start a fresh audit for subsequent product actions; retain the strict policy and assertions.

Review notifications live in `src/lib/notifications/`. Event metadata is part of the same comment
write as the shared unread activity cursor. Never send email from a toolbar client or detached
promise. The scheduled `Review notifications` workflow runs the awaited Cosmos-backed worker with
the existing production configuration. Dispatch rechecks access, private visibility, subscription,
mute and `getReadSequence`; keep the optional verified guest flow separate from posting. See
`docs/review-notifications.md` for the event/delivery contract and failure evidence.
`/api/email/reports` checks its secret header and expected Event Grid subscription before validation
or writes. Compare the subscription name case-insensitively, as Azure resource identity requires.
The per-subscription credential and expected name bind the handshake to the subscriber; do not
treat validation topic metadata as identity.
Delivery reports must additionally use the configured ACS topic. Rejection logs contain only
bounded reason codes, never header values, addresses, payloads or provider status messages. Bounces suppress only by normalized address hash and bounded reason; report
receipts retain hashed event/operation ids for 30 days and survive a mailbox confirmation. No raw
provider message, address or report payload may be logged. Skip suppressed digests; a failed read
must retry. Show the generic notice only in the admin invite action. Requested sign-in/guest
confirmation remain available and clear suppression only on completed mailbox proof. Ledger
matching is production-gated until live message-id correlation is proven.
The scheduled worker is packaged before credentials are loaded, then runs without a checkout in
`production-worker`, a main-only environment with no approval gate. Its separate Azure app uses
OIDC plus `AzureCliCredential` for Cosmos and Blob data access; deployed requests keep Vercel
federation through `azureDataCredential`. It accepts no Cosmos/Blob account key or dotenv file.
`UIER_WORKER_SETTINGS` contains only allowlisted data, transport and integration-crypto settings;
`scripts/worker-settings.mjs` masks each value before loading it, except the `"0"`/`"1"`
`SLACK_DISTRIBUTION_APPROVED` gate (masking `1` hid exit codes and delivery ids). Only a run's own
failed or ambiguous attempts fail it; ledgers already waiting for review are named as warnings with
their `retry_delivery` id on every run. No Vercel token or environment
pull is available. Refresh the snapshot after credential/crypto changes with
`pnpm -C infra exec node scripts/configure-worker.mjs`; never replace app keys to repair a worker.
Every run validates data scopes first; `verify_only` stops before writes or dispatch.
`integrations_only` manual runs skip email and reject a simultaneous email retry.
MCP event webhooks are swept after integrations on every run except `verify_only` (60 seconds); a
subscriber's failing endpoint never fails a run, only an unexpected worker error does.
GitHub Settings can reuse installations known to the current
workspace, but fresh PKCE user authorization and repository administration checks remain required.
Digest unsubscribe headers are persisted in `attempt.message.headers`; retries preserve them.
`/api/notifications/unsubscribe` changes state only on a cookie-free RFC 8058 POST; GET and
`/notifications` remain read-only. Never accept verify tokens for unsubscribe/mute.
Digest wording uses only the recipient's eligible batch and current authorized participant names;
never name other mention/assignment recipients. Events store item/new-assignee ids, never text.
`emailCommentExcerpts` defaults off and is saved through `adminProject`; commenters see its state.
New attempts rebuild from fresh settings/items at the send boundary; retained provider operations
keep their exact message, which can retain opt-in excerpts until reconciliation without a TTL.

- While implementing, run `pnpm typecheck` plus the relevant spec file and project (`API` or
  `Desktop Chrome`; add `Mobile Chrome` for touch or responsive changes). Direct Playwright
  commands need `pnpm build` after app/toolbar changes. Enable untagged browser cases with
  `PLAYWRIGHT_FULL=1` and use `--retries=0`; the file/project filters still limit the run.
  See [focused commands and test categories](../../docs/development.md#while-implementing).
  New features do not require `pnpm test:full`; reserve it for broad regression verification
  when focused checks are insufficient or a full run is explicitly requested. Documentation-only
  changes need content and link checks, without application checks.
- Before pushing code, dependencies or build/test configuration, run `pnpm typecheck` (runs
  `next typegen` first), `pnpm build`, then the short `pnpm test` check (Playwright
  against `next start` on `PORT`, default 4004, e.g. `PORT=4104 pnpm test`; API, Desktop and
  Mobile Chrome). The default runs every `.api.spec.ts`, desktop `@smoke` tests and mobile
  `@mobile-smoke` tests: landing, sign-in, security policy, installation, owner/guest discussion,
  capture, routes and recovery. It has no retries and a three-minute total budget; CI has two
  workers and local runs have four. Browser essentials can run in parallel within a file;
  API tests and the full suite retain their file ordering. Failures retain traces, and
  `playwright-report/results.json` records timings. `pnpm test:full` restores every browser spec
  and two retries. For a specific regression use
  `PLAYWRIGHT_FULL=1 pnpm -C apps/web exec playwright test <file> --project="Desktop Chrome" --retries=0`.
  Keep new feature permutations in the full suite; do not add smoke tags by default.
  A server that already answers on that port is never reused (the run fails), so
  stop `pnpm dev` or pick another `PORT`. Rewrite suggestions go to `e2e/support/anthropicStub.ts`
  on `PORT + 1000`, never to the real API.
- Accessibility is part of both suites: new pages should be added to an `assertAccessibility`
  test. Keep text at 4.5:1 or better (`text-muted-foreground` is the lightest text colour).
- The detailed feature coverage below and elsewhere in this guide describes the full suite;
  only tagged browser essentials run in the required check. API coverage always runs.
- `project-review.spec.ts` covers privacy-safe owner notes (including manual clipboard fallback),
  ended-session sign-in return URLs and offline/reconnect notices, with keyboard, 375 px and axe
  checks. `embed.spec.ts` verifies missing cross-origin configuration sends no public comments or
  visitor requests and opens the appropriate install guide; configured load failures retain retry.
- `e2e/launch.spec.ts` combines installation, owner/guest discussion, routes, capture, recovery and
  keyboard movement. `PLAYWRIGHT_CROSS_BROWSER=1` adds focused Firefox/WebKit launch projects;
  install those engines first. `launch-performance.spec.ts` attaches the 100-thread and long-page capture measurements
  (`?sections=<n>` on the reviewed site, `e2e/support/reviewedSite.ts`).
  Keep `docs/mvp-launch-verification.md` honest about pending dependency, hosted and physical-device
  evidence; passing local fixtures alone must not close the launch gate.
- Locally the comments API keeps comments in memory; `COSMOSDB_CONNECTION_STRING` in `.env.local`
  points it at a separate development Cosmos DB account. Deployments get their Cosmos DB settings and `UIER_COMMENTS_SECRET`
  from Pulumi: separate production/preview Entra identities with Vercel OIDC tokens
  (`src/lib/db/client.ts`), scoped to `comments`/`app` or `comments-preview`/`app-preview`.
  Production has no Cosmos connection string; setting both endpoint and connection string is rejected.
  Cosmos account-key authentication is disabled. Standalone production operator commands use the
  explicit `UIER_AZURE_AUTH_MODE=operator` with `AzureCliCredential`; Vercel and Actions contexts reject
  that mode. Query profiling also uses the signed-in operator's scoped Entra roles, never account keys.

## Toolbar in development

`ClientProvider` loads http://localhost:4005/index.js (the port after `PORT`, `UIER_TOOLBAR_DEV_ORIGIN` from
`next.config.ts`) in development only, and `next dev` rewrites
`/toolbar.js` and `/review.js` to that watch build, so a locally reviewed site's install snippet never
runs a stale `public/toolbar.js` from an earlier `pnpm build`. Open any page with a
review link, `?review=true` or `?toolbar-code=<project code>` (for example `/brand?review=true`), to
see the real toolbar on top of it. uier.io's public marketing layout embeds showcase mode on every page, using the same-origin cookie API
backed by the static project `uier00000001`; feedback on `/app` pages (the sidebar's "Give feedback",
`FeedbackButton`) is private to its author and the team (`isPrivateAppFeedback`).
`src/lib/comments/publicProject.ts` provisions its workspace,
project and permanent starter threads on first use, and copies legacy production feedback once. New
visitor threads expire after 90 days; starter threads and their replies do not expire. Local subdomains
retain independent host partitions for tests. On a project's site the
script's `data-uier-project` decides the project, and `?review=true` there reviews that project
(`e2e/project-review.spec.ts`). The marketing layout embeds the toolbar with its React component
(`@uier/toolbar/react`, see `ToolbarScript`).

Every account joins `w_uier_public`. Only normalized, valid addresses from the server-side
`UIER_STAFF_EMAILS` allowlist become admins with all projects; everyone else is a commenter scoped
to `uier00000001`, including hand-set admins. Provisioning backfills accounts with a durable receipt,
but resets stored admins on every instance's first `ensurePublicProject` call. Sign-in and app
requests reconcile memberships without invitations. `getAppContext` and `memberActor` enforce the
current allowlist at read time too, including old review tokens and MCP connections. Missing/empty
configuration means no staff; malformed entries are skipped using `emailSchema`. Preserve the
selected workspace and personal onboarding. The public workspace has no Users page, invitations,
member removal or project creation; public project settings are fixed, with personal email preferences
still available. Enforce this in services as well as the UI; earlier invitations cannot assign roles.
Keep all ordinary workspace behavior unchanged. Admin author filtering uses `app/commentAuthors.ts`:
random, account/project-bound references expire after 24 hours, and stored author ids never cross
the client boundary. `CommentsStore` matches both openers and remaining replies before list limits.
App reply deletion reuses `deleteProjectCommentItem`; thread deletion must keep screenshot cleanup
and never delete sequence or rate-limit documents (only project deletion removes the sequence). On the public project's
same-origin comments API, `__Host-uier_session` takes precedence over guest identity. Store `user:<id>` just
as the review API does, resolve current account names for DTOs, and keep private app feedback
author-only in the public API. Read the current public project and apply `assertCanUseComments`
on every showcase request; the cached provisioning result is not current access policy. Listing,
activity and both read routes share `comments/visibility.ts`, including legacy `/app` threads
without a private flag. Migration marks copied `/app` threads private. Guest comments are not
automatically reassigned on sign-in.

Assignment eligibility lives in `review/participants.ts` and is rechecked inside optimistic
comment mutations. Mentions store selected account ids with UTF-16 text ranges; review DTOs
expose identity metadata only to members. App and toolbar must share these checks.

- `src/lib/comments/activity.ts` and `readState.ts` own thread activity and reviewer read cursors.
  Read acknowledgements require current project/thread access and acknowledge only a rendered
  sequence. Mark as unread (`markThreadUnread`, `DELETE .../read`, `markCommentUnreadAction`) is the one
  explicit move back: to just before the latest activity by someone else, never for own-only threads. Toolbar and app use the same member cursor; notifications must reauthorize before
  reading it for suppression. Do not equate resolution with read state or expose actor ids in DTOs.
  Bulk acknowledgement uses `comments/bulkRead.ts` and `review/bulkRead.ts`: validate every id/cursor
  before writes, at most 200 threads/48 KiB per request and four concurrent cursor writes. Review
  routes retain verified-write protection; public routes retain BotID. Return only successful activity
  receipts, skip missing/hidden/failed threads without reasons, and reauthorize each project thread.
  App list/board actions snapshot the shown unread threads and send sequential batches, retaining
  failed cursors for toast retry. Neither bulk nor single reads acknowledge newer activity.

- `e2e/activity.spec.ts` exercises project/showcase adaptive refresh with the Playwright clock:
  15-second active cadence, 30 after one minute idle, 60 after two, immediate return, held-response
  coalescing, pause/resume, drafts/focus, unread and revoked-access cleanup. Count identity/viewer,
  comments and activity endpoints separately; do not equate cycles with HTTP requests or invoice savings.
  See [refresh contract and measurements](../../docs/review-workflow.md#polling-request-measurement).

- Activity summaries use `CommentsStore.listActivity`, a compact projection over all authorized
  threads, so badge counts do not inherit text-list limits. Unread content is selected before
  applying response limits. Preserve legacy author-only projections and private-thread filtering.

## Anchor updates

`PATCH /api/comments/<id>/anchor` and the matching project review route validate selectors with the
existing schemas and call `comments/reattachAnchor.ts`. It enforces the saved page key and anchor revision
on each ETag retry; project updates also require author/admin rights and the original allowed origin.
Retain the original and immediately previous position plus change time/count in `anchorContext`, without
actor identifiers. DTOs allowlist its fields. It follows comment visibility and retention; no image or
message is replaced. Keep the privacy policy and toolbar guide aligned with this context.

- `src/lib/app/environments.ts` owns origin labels, explicit shared groups (Settings → Environments, "Shares feedback with") and historical-source
  fallback. Apply `environmentFilter` before storage limits and before activity/unread selection;
  Cosmos and memory stores share `repo/originFilter.ts`. Do not infer missing origins or retarget
  removed sources. App direct-comment redirects load the authorized stored thread and retain its
  permitted original source plus canonical saved page state. Environment filters never grant access.

## Integration foundation

`TwoWaySync` and its admin-only action save the independent, default-off `twoWaySync` connection
setting for GitHub, Linear, Azure DevOps and Notion. Notion requires a mapped Status/Select property.
`statusSync.ts` rotates a bounded accepted-ledger scan in the scheduled worker. Status-only delivery
shares the outbound lease and authority boundary; provider writes are prohibited. Recheck current
source/version, visibility, destination, toggle and admin before conditionally updating activity,
notifications and the source marker together. Pending uier edits win; polling never acknowledges
outbound progress or recreates external objects. Slack has no task-status sync.

`src/lib/integrations/` owns the shared outbox and delivery protocol described in
[`docs/integrations.md`](../../docs/integrations.md). Every eligible non-public project mutation
records its source signal in the same write, including an unbound request snapshot; do not gate
that write on cached settings. Hard deletes use the conditional delete+tombstone batch. The
public showcase, private-only changes and no-ops remain excluded. Ordinary DTOs/reads never
contain signals or tombstones.

Discovery is bounded and cursor-paged by indexed `syncKey`. Acknowledge only after every target
is durable and source/binding checks still pass. Each provider gets independent leases, attempts,
budgets and progress. Preserve uncertain creates for reconciliation, and run cleanup with no
feedback packet. Every external call checks current membership, binding, source and destination.
Never persist feedback bodies in integration ledgers or expose credentials in views/logs.

The registry resolves all five adapters lazily to avoid initialization cycles with shared authority
helpers. Settings rendering is database-only; provider option/schema requests require an explicit
admin action. OAuth return routes bypass the signed-out proxy so transient codes and states are
never echoed into a sign-in return URL. Provider credentials are production-only, configured
through the setup runbook. Off/disconnect must work even when credentials are unavailable.

GitHub organization approval returns (`setup_action=request`, no installation id) consume bound
state, recheck admin access and select the original workspace before opening `settings/integrations?github=pending#github`.
Invalid GitHub setup/callback returns open `/app/github/error` in the app shell with recovery and
organization approval guidance. Never carry unverified project ids, callback codes or state into
that destination. `github.api.spec.ts` and `github.spec.ts` cover pending approval and recovery.

`replySync` is a separate default-off opt-in for all five providers. `replies.ts` bounds native
comment reads and owns marked-copy reconciliation; `importReplies.ts` projects source-labelled,
read-only imports. Server-only `integrationSource` identifies the external target and must never
appear in DTOs. Do not map provider identities to members, infer deletion from list absence, or
blindly resend uncertain creates. Commit incoming status/replies together after the source,
toggle, binding, destination and admin checks; keep verification-state semantics intact.
Slack history needs an explicit optional-scope reconnect; Notion needs read/insert comment
capabilities. Keep normal notification permissions minimal. Native-copy cleanup also runs when
reply sync is off. The React settings serialize booleans, never grants or source provenance.

The shared API suites are
`integrationSignals.api.spec.ts`, `integrationCredentials.api.spec.ts` and `integrations.api.spec.ts`.
Azure DevOps (`azure-devops/`) uses Microsoft Entra delegated OAuth with one grant per project
connection, so its work items are written as the connecting admin. It mirrors each thread into one work
item's text field rather than its Discussion, sets the mapped state only when the uier status changes,
and reconciles a lost create through WIQL and the copy's marker; see
[the Azure DevOps design](../../docs/azure-devops-integration-plan.md). `azure-devops.api.spec.ts` and
`azure-devops.spec.ts` run against `e2e/support/azureDevOpsStub.ts`.
Provider tests and live acceptance are additional gates, not substitutes for shared isolation.

## Feedback export

The public and review `comments/:id/context` routes and the app `copyIssueAction` read fresh
authorized feedback. `src/lib/review/feedbackContext.ts` is the common project service;
`src/lib/comments/feedbackContext.ts` projects filtered DTOs into the shared
`@uier/toolbar/feedback-context` model. Keep public/guest browser restrictions, deleted evidence
redaction, canonical page state and protected screenshot references intact. The complete packet
contract is in [docs/feedback-context.md](../../docs/feedback-context.md); future MCP/tracker
work should reuse it. Coverage lives in `e2e/feedback-context{,.api}.spec.ts`.
The formatter renders inline values (including titles and names) as literal code spans, suppressing
tracker autolinks/mentions without changing the structured context. Only approved explicit links
remain clickable.
Public-project exports include `identity.projectId: uier00000001`, derived from the resolved
partition even for legacy records. Isolated local host partitions have no project id. Never infer
the owning project from the reviewed page path: `/app/projects/<id>` feedback belongs to uier.

## Project review briefs
`DbProject.brief` is optional plain text, trimmed/cleared by `projectBriefSchema` with the shared
`MAX_PROJECT_BRIEF_LENGTH` (2000). Only admins edit it through `saveProject`; non-admin settings hide
the form. `getReviewInfo` allowlists it only when `canComment`, with environments. Never expose it in
invited signed-out or comments-off responses. The toolbar renders literal text and line breaks.
`GET /api/visitor?path=...` returns the current page's app-feedback privacy using
`isPrivateAppFeedback`; it contains no copied client path heuristic.

## Authenticated MCP connector

`/api/mcp` is stateless Streamable HTTP using the official MCP SDK. `src/lib/mcp/` owns
authentication, scopes and tools; `src/lib/mcp/oauth/` is uier's own OAuth 2.1 authorization server
for this endpoint only. The contract is [docs/mcp.md](../../docs/mcp.md); the design record and its
decisions are [docs/mcp-oauth-plan.md](../../docs/mcp-oauth-plan.md). Two kinds of connection resolve
to one `McpIdentity` in `credentials.ts` (user, `connection: { id, kind, name, clientId? }`, scopes,
`AgentAccess`):

- **Connected apps (OAuth).** `uier_at.` access tokens backed by an `mcp-grant`, created through
  consent at `/app/connect/<requestId>` and listed under Account → Coding agents → Connected apps.
- **Access tokens.** `uier_mcp.` manual credentials for environments without a browser: 30-day,
  named, read-only by default, with explicit project selection in the current workspace; raw secrets
  are shown once and only hashes are stored. They become
  `{ kind: 'selected', workspaces: [{ workspaceId, projects }] }` internally.

Never accept cookies, review tokens, project codes or guest ids as MCP authentication.

**Grants are evaluated live.** A grant stores a selection (`AgentAccess`: `all`, or chosen workspaces
each with `'all'` or project ids) and scopes, never a permission snapshot. `mcpProject` resolves the
project's workspace (`grantedWorkspaceOf`, else `findProject`), checks `accessCovers`, then
`memberActor` for current membership, team grants and the staff allowlist, on every tool call and
screenshot resource read; the review services recheck private visibility. "Including new ones" is the
stored `all`, resolved at request time. Never cache a positive decision, copy access into a grant or
widen a stored selection on the person's behalf. `list_projects` uses `listAccessibleWorkspaces`
(memberships through `publicProjectMember`, `hasProjectAccess` per workspace, bounded at 50
workspaces and 1000 projects).

OAuth rules (`src/lib/mcp/oauth/`, `app/api/oauth/`):

- `mcpOauthEnabled()` is true unless `UIER_MCP_OAUTH=off`. Off makes the metadata routes and every
  `/api/oauth/*` route answer 404, drops the discovery challenge, and makes `/api/mcp` reject OAuth
  access tokens already issued.
- Discovery: `next.config.ts` rewrites `/.well-known/oauth-protected-resource/api/mcp` and
  `/.well-known/oauth-authorization-server` to `app/api/oauth/metadata/{protected-resource,authorization-server}`.
  Public JSON, `Access-Control-Allow-Origin: *`, five-minute cache. No root protected-resource document,
  no OpenID configuration. Every 401 from `handleMcp` carries the RFC 9728 challenge
  (`bearerChallenge`): `resource_metadata`, `scope="feedback:read"`, and `error="invalid_token"` when a
  token was presented.
- The issuer is the `appBaseUrl()` origin. The resource is exactly `<origin>/api/mcp`, compared with
  `isMcpResource`, never by prefix; tokens are accepted only for it and never forwarded.
- `app/api/oauth/{authorize,token,register,revoke}` run through `oauthEndpoint` (RFC 6749 JSON errors,
  `no-store`) and the limits in `http.ts`: per IP and hour authorize 60, token 3000 (hosted clients share
  egress addresses), register 20 (IPv6 per /48; 2000 globally), revoke 120; per subject and hour 30
  approvals per account, 120 refreshes per grant, and metadata fetches 30 per requester and 600 per
  host, falling back to the client's last valid document (`known-<hash>`, 30 days) when spent. Token, registration and revocation take no cookies, send no CORS headers and are not
  behind BotID. Authorization requests stay out of `/app`: only the stored random request id passes
  through sign-in, and `/app/connect/error` is a signed-out app path in `proxy.ts`. Errors go back to
  a redirect URI only after the client and that URI are validated, and before consent only to a
  loopback URI; HTTPS redirect URIs get `/app/connect/error` instead (no open redirect).
- Clients (`clients.ts`): Client ID Metadata Documents are fetched only from hosts that resolve to
  public addresses, checked on the connection's own lookup, with no redirects, 5 seconds and 16 KiB.
  `UIER_OAUTH_TEST_HTTP_CLIENT_METADATA=1` admits `http://localhost` metadata URLs in local runtime only,
  for tests; never set it on a deployment. Dynamic registration drops unacceptable redirect URIs and
  never issues a secret. Redirects (`redirects.ts`): HTTPS exact, loopback with the port ignored, no
  custom schemes. Client names are untrusted and never presented as verified.
- Tokens (`tokens.ts`): opaque, SHA-256 hashed, in the `mcp-user:<userId>` partition. S256 PKCE only;
  codes last 60 seconds and a replay revokes the grant; access tokens last 1 hour; refresh tokens
  rotate with a 60-second grace, and later reuse revokes the grant; grants end 30 days after the last
  refresh or 1 year after creation. Each access token is checked against its grant (present, active,
  same client) on every request, so deleting the grant revokes everything at once. Never log tokens,
  codes, verifiers, `state` or request bodies.
- Consent (`authorize.ts`): approval rechecks the session user, validates every chosen workspace and
  project with `validateAccessChoice`, enforces 20 active connected apps per user unless replacing one,
  and consumes the stored request with a conditional delete before creating a code. Consent is always
  shown; `prompt=none` fails with `interaction_required`.
- Attribution and idempotency keys use `connection.id` (grant id or credential id), never the access
  token, so retries survive a refresh. `AgentSource.kind` marks OAuth.
- The privacy policy ("Coding tool access" and the retention list) and the security page's "Coding
  tool sign-in" control describe these records, lifetimes and limits. Change them, and `docs/mcp.md`,
  with any change to what `src/lib/mcp/oauth/` stores or how long.

Account → Coding agents (`src/components/app/mcp/CodingAgents.tsx`) has the client setup, **Connected
apps** (one row per OAuth grant, an allowlisted `connectedAppView`, Revoke through an `AlertDialog`)
and collapsed **Access tokens**. The consent page is `app/connect/[requestId]` (its own centred layout,
no sidebar) and `app/connect/error` is public. `src/lib/mcp/oauth/actions.ts` approves or cancels by
returning the client's callback URL, and the page navigates there itself (`form-action 'self'` blocks
redirects after a form post). Every `/app` server action refreshes the page (the proxy sets the review
SSO cookie), so the page always renders `ConnectConsent`, which keeps the outcome after the request is
consumed. Both share `ClientDetails` (Unverified, Published at, Sends you back to) and `scopes.ts` labels.

The route has `maxDuration = 30`; `handleMcp` races transport handling against a 25-second deadline
(overridable by API specs) and the request abort signal, returns a JSON-RPC error on interruption
and always closes the server. Screenshot resources map `ApiError` to `InvalidParams` with its
code/message, zod errors to fixed `InvalidParams` text and unexpected errors to `InternalError`
with `The operation failed.`; the request log records the failure. Never return raw storage diagnostics.

**Request logs.** `handleMcp` emits one `mcp_request` event per request through `mcp/telemetry.ts`
([request logs](../../docs/mcp.md#request-logs)). `createFeedbackMcpServer` calls `log.watch(server)`
before registering anything, so every tool, prompt and resource is logged by name and its own schema;
handler catch blocks call `noteMcpError(error)` before mapping the error. Events carry names, codes,
counts, sizes and keyed connection/account references. Argument values are kept only for booleans,
`null`, numeric fields and options the schema declares; never log content, ids, names, tokens, URLs or
error messages, and never let logging change or fail a response. `e2e/mcpTelemetry.api.spec.ts` covers
it; the other MCP specs pass `{ emit: quiet }` to `handleMcp`. The privacy policy's "Coding tool access"
describes these records: change it with what they contain. The event contract,
`mcpRequestEventSchema`, lives in `mcp/telemetrySchema.ts` (zod and scope names only) so
`scripts/mcp-report.mjs` and `mcp/report.ts` can validate exported events without loading the server;
`e2e/mcp-report.api.spec.ts` covers the [daily report](../../docs/mcp.md#daily-report).
Access tokens remain bound to one workspace; connected apps reach the workspaces chosen at consent.
Account guidance and `mcp/workflows.ts` explain where feedback about uier itself lives (the uier
workspace's public-feedback project). Missing project grants stay `not_found` without exposing
project existence; direct users to `list_projects` and to reconnecting or explicit token setup
rather than expanding access. List-tool descriptions and field schemas must both
state the 1–25 limit and `nextCursor` pagination, since clients may flatten schema constraints.

Tools reuse review services. Replies and status/assignment events retain the human author plus
connection attribution. All mutations require a stable idempotency key and share atomic submission
receipts; do not implement retry deduplication in process memory. Reads never acknowledge unread
activity. Feedback, anchors, names and images are untrusted content. Search is deliberately bounded
to the latest 1000 threads; pages contain at most 25 summaries. Keep the documented context
contract shared with developer issue export: `projectFeedbackExport` in `review/feedbackContext.ts`
produces the same `@uier/toolbar/feedback-context` packet. Screenshot resource reads must honor
its deleted-evidence filtering too. `e2e/mcp.api.spec.ts` exercises the official HTTP client
and service isolation; `e2e/mcp.spec.ts` covers user credential setup, client access, revocation and
light/dark accessibility; `e2e/mcpOauth.spec.ts` runs the SDK client's OAuth flow (dynamic
registration, loopback listener) through sign-in, consent, approval, `list_projects`, a reply and
revocation in Account (`@smoke`), plus cancel, request reuse, another account and the error page.
This connector does not prove #90 launch acceptance.

**Events (webhooks and polling).** `src/lib/mcp/events/` implements MCP Events webhook and poll
delivery as ChatGPT consumes it ([docs/mcp.md](../../docs/mcp.md#events-webhooks-and-polling)): `protocol.ts` registers
the top-level `events` capability and `events/list|subscribe|unsubscribe|poll` and owns the error code
table; `feed.ts` the stateless poll feed behind `events/poll` and the `list_feedback_events` tool (an
opaque client-held cursor: watermark a minute behind, the start time, and short ids already returned
since the watermark, so late commits arrive once; nothing stored per client); `catalog.ts` the event names, argument/payload schemas (additive only) and the mapping from a
thread's `notificationEvents`; `subscriptions.ts` deterministic subscription ids, TTL grants, limits,
endpoint verification and encrypted `whsec_` secrets; `webhook.ts` Standard Webhooks signing and the
POST, which goes only to public HTTPS on the default port through `publicNetwork.ts` (the same
connection-time address check as OAuth metadata fetches), never follows redirects and reports fixed
failure categories only; `delivery.ts` discovery from `listChangedSince` with a per-project cursor,
deterministic delivery records, leased attempts with bounded retries, and `runMcpEventWorker`.
Events never get their own write path: add an event kind to `notificationEvents` and map it in the
catalog. Every attempt rechecks the connection (`currentMcpConnection`), `mcpProject` and
`canSeeComment`; lost access deletes the subscription. Never deliver a connection's own changes
back to it, never log callback URLs, secrets, arguments or payloads, and keep payloads minimal and
marked untrusted. `review/comments.ts` calls `queueMcpEventDelivery` after `createProjectComment`,
replies and `changeComment`; it runs only when `instrumentation.ts` registered `after()`, so API
specs call `dispatchProjectEvents` themselves. The scheduled worker sweeps after integrations.
`UIER_MCP_EVENTS_TEST_HTTP_CALLBACKS=1` admits `http://localhost` callbacks in local runtime only (the
Playwright server sets it); never set it on a deployment. `e2e/mcpEvents.api.spec.ts` covers the
contract with `e2e/support/webhookReceiver.ts`; `e2e/mcpEvents.spec.ts` proves delivery after a real
request.

`mcp/clients.ts` builds the Account client tabs from one endpoint, without taking a token as
input. Keep these reference-only configurations aligned with the linked official docs and
[docs/mcp.md](../../docs/mcp.md#connect-claude-code).

OAuth, the setup Account offers first. Claude Code is the only client offered with OAuth:

- [Claude Code](https://code.claude.com/docs/en/mcp): `claude mcp add --transport http uier https://uier.io/api/mcp`,
  then `/mcp` → Authenticate. An `Authorization` header in the entry turns Claude Code's OAuth off, so
  the setup tells people to remove one from an existing entry.

Access tokens, for environments without a browser and for clients not offered with OAuth:

- [Claude Code](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers), OAuth (`auth: 'oauth'`),
  then `/mcp` → uier → Authenticate. A configured `Authorization` header disables its OAuth path, so
  the tab tells people to remove one from an existing entry:
  ```sh
  claude mcp add --transport http uier https://uier.io/api/mcp
  ```
- [Codex](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers), `~/.codex/config.toml` (access token until its OAuth login is verified):
  ```toml
  [mcp_servers.uier]
  url = "https://uier.io/api/mcp"
  bearer_token_env_var = "UIER_MCP_TOKEN"
  ```
- [Cursor](https://cursor.com/docs/mcp#config-interpolation), `.cursor/mcp.json`:
  ```json
  { "mcpServers": { "uier": { "url": "https://uier.io/api/mcp", "headers": { "Authorization": "Bearer ${env:UIER_MCP_TOKEN}" } } } }
  ```

Never substitute the newly created secret into a setup block or skill. Never offer a shell command
that expands a bearer header into saved settings. Clients must inherit the environment variable. Verify each offered client against its
current docs and a reachable
deployed endpoint; record exact checks in the PR and omit clients whose connections cannot be verified.
Do not relax the Origin check or deployment protection to make a client connect.
Offer OAuth for a client only after live acceptance against a deployed endpoint (discovery, consent,
the return to the client, a refresh after an hour, revoke and reconnect), recorded in the PR with the
deployment, client version and date. Claude (web, desktop and mobile), Codex, Cursor and VS Code are
not offered with OAuth yet and keep access tokens. Claude custom connectors connect from Anthropic’s
servers (no localhost) and return through `https://claude.ai/api/mcp/auth_callback`. Do not offer
Claude's request-header setup: in Team and Enterprise an Owner adds connectors for the whole
organization, which would share a personal token. Do not offer a bridge.
[VS Code’s documented masked input](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
was checked (`promptString`, `password: true`, `${input:...}`), but its deployed client connection
could not be verified in this session, so no ready block is offered.
[Windsurf’s docs](https://docs.devin.ai/desktop/cascade/mcp) now describe legacy Cascade in Devin
Desktop (`serverUrl`, `${env:UIER_MCP_TOKEN}` in headers); it is not offered without a verified client.

`mcp/prompts.ts` registers `triage-feedback` (`projectId`), `fix-feedback` and `report-back`
(`projectId`, `commentId`). Share identifier schemas with tools in `mcp/schemas.ts`. Recheck
`mcpProject` even when rendering instructions; never echo failed arguments or embed feedback.
Report-back is registered only for reply/status grants and names only the permitted writes.
`mcp/workflows.ts` is the common source for prompt instructions, the untrusted-content rule, the
citation rule (link feedback as `[uier #12](comment link)`, never a bare `#12`, which GitHub and
GitLab link to their own issue) and the copy/download `SKILL.md` in Coding agents. Keep the tool/scope table aligned with the server.
Triage changes nothing, fix proposes local code work only, and report-back waits for human approval
before every write. The skill also requires approval for assignments and stable retry keys.

`list_feedback` shares path, source, assignment and activity projection with the app through
`app/projectCommentRouting.ts`. Canonicalize its optional path with `pagePath`; pass path and
`environmentFilter` into `listProjectComments` before the 1000-thread storage limit. Validate
environment ids against `environmentOptions` plus `unknown`/`removed`; never use the toolbar's
fallback selection for MCP input. Other filters apply only within that window. Read the connection
owner's cursor after filtering visibility; never acknowledge it. Deleted first messages omit
author kind and screenshot presence, and author ids never enter summaries.

`get_feedback_batch` accepts 1–10 distinct ids and reuses `projectFeedbackExport` in request order.
Missing, deleted and private ids share `not_found`; individually oversized packets return
`too_large`. Its 256 KiB cap preserves whole packets and returns `remainingIds` for retry.
Screenshot resources require both a protected exported image and `screenshots:read`. Every call
rechecks scope, selected projects and current membership through `mcpProject`. Batching reduces
transport requests, not per-thread export storage reads. Keep `get_feedback`'s contract stable.

Project comment rate limits use only server-resolved actors: members get 100 new comments and 300
replies per project per hour and skip the 30-write shared IP budget. Guests and `PUBLIC_PROJECT_ID`
commenters retain visitor limits (10 new comments, 30 replies and 30 writes per IP per hour).
The anonymous comments service always uses visitor limits. MCP replies first consume a 30-reply
per-connection/project budget (access token or connected app), then the owner's budget; rejected
connections must not exhaust the owner. Page, screenshot, paid rewrite and MCP transport limits stay independent. Coverage is in
`review-rate-limits.api.spec.ts`, `public-project.api.spec.ts`, `mcp.api.spec.ts` and the unchanged
`comments.api.spec.ts` rate cases.

## Cosmos query diagnostics

`app/store.ts` keeps complete-list queries complete and exposes exact `count` for totals that
must not load or cap documents. Memory and Cosmos implementations must agree. No default TOP
is permitted for authorization, membership or erasure. Notification selection filters due rows;
lease/access/idempotency checks remain at dispatch. The store's opt-in sampled diagnostics
(`db/diagnostics.ts`) must accumulate every SDK page and never log values, documents, SQL,
continuations or raw diagnostics. See [Cosmos query costs](../../docs/cosmos-query-costs.md) for
the operation inventory, measured limits, safe preview profiling and the unchanged-frequency
forecast. In-memory tests cannot establish RU savings.

## Privacy cleanup

`screenshotSchema` parses asynchronously and uses Sharp to decode/re-encode every incoming image,
with a 4096² pixel cap, first-frame-only output and no metadata. Stored output stays within 512 KiB
and 4096 px per side. All JSON route validation uses `safeParseAsync`.
`comments/cleanup.ts` is shared by whole-thread deletes and public screenshot replacement.
Authorized deletes persist an identifier-only cleanup intent before deleting the thread;
pending intents never expire, while completed intents expire after one day;
the scheduled notification worker retries related notification/read cleanup and legacy copies.
It also pages through screenshot metadata older than one hour, rechecks comment references and
uses image etags so a concurrent replacement survives the orphan sweep. `src/lib/screenshots/blobStore.ts`
stores raw bytes in private Azure Blob Storage; Cosmos stores only references on new writes. The
worker migrates 20 legacy images per environment per tick, preserving remaining TTL, and sweeps
Blob orphans in production and preview. See [screenshot storage](../../docs/screenshot-storage.md).
Direct toolbar reads negotiate a 60-second read-only URL and download without uier headers; do
not redirect header-authenticated requests to Blob Storage. MCP/integrations read bytes server-side.
Related record TTLs use the thread’s remaining lifetime. Completed notification ledgers expire
after 30 days; the thread’s discovery floor prevents replay after ledger expiry. Blocked ledgers
are queried by failed/ambiguous status.
`copy-fonts.mjs` publishes the pinned Geist fonts and license before dev/build; static font files
are CORS-readable. `cspSources` allows the API origin for both `style-src` and `font-src`.

## Browser extension runtime spike

`src/lib/extension` and `/api/extension` use separate revocable sessions: updated packages request
`renewable: true` for 15-minute access, rotating refresh with 30-day inactivity and one-year absolute
limits. Legacy packages retain eight-hour sessions. Refresh uses atomic session/token replacement,
hashed credentials and persisted attempt hashes: exact retries return the same derived successor,
different-attempt reuse revokes the session. Known refresh credentials can revoke after access expiry.
Project/exact-origin credentials last five minutes. UIER_EXTENSION_CLIENT_IDS is an explicit allowlist; disabled by
default. It grants transport/registration only, never identity or BotID bypass. Recheck current
membership, session and addresses before calling shared review services. Keep embed CORS unchanged.
`/app/extension` is explicit consent after first-party sign-in. `/extension-verification` is a
nonce-protected frame for the packaged helper; only registered extension origins may frame it.
No app cookie reaches the worker. Read [the design and remaining gates](../../docs/browser-extension.md).

Installation uses the script/extension tabs in InstallGuide. Keep Check installation inside the
script tab; comment activity does not prove embed installation. BrowserExtensionGuide reads the
server-only distribution gate (UIER_EXTENSION_AVAILABLE=1, valid STORE_ID also in CLIENT_IDS).
Never invent a store URL or enable it without hosted/store acceptance.

`public/extension-demo.html` is an unindexed, deliberately plain reviewer fixture without the
marketing layout, embed, scripts or styles. Its exact-path proxy policy denies all page resource
loads. Keep it free of customer data and sign-in secrets; reviewers create their own isolated
project. The API check preserves that boundary; the browser check scans its content directly
because the ordinary public-page accessibility helper waits for a showcase toolbar.

The public `/browser-extension` page and the `/guides/browser-extension` setup guide describe the
published 0.1.2 extension. Their copy follows BrowserExtensionGuide, the listing worksheet, the
popup (`apps/extension/src/popup.tsx`) and the receipts in `docs/browser-extension.md`; popup labels
and the published store ID live in `src/lib/extension/release.ts` (static pages build without the
hosted `UIER_EXTENSION_*` settings). The store button uses the same `chromeWebStoreUrl` as the app's
link. Recheck both pages, and the legal pages' extension sections, when a release changes labels,
permissions, sign-in or capture. `browser-extension.api.spec.ts` checks the store link and
`browser-extension.spec.ts` their content.


## App triage

`@uier/toolbar/triage` owns the pure priority vocabulary/default and deterministic literal word matcher.
`ProjectComments` searches only the server-authorized snapshot (200-character `q`, debounced
replaceState), alongside local filters. Environment/author still navigate. `loadProjectComments`'s
window callback discloses the 1,000-thread storage cap even if hidden rows shrink the client snapshot.
Never send deleted or ineligible text to client search.

`review/comments.ts` owns priority, assignment and status writes. `bulkTriageSchema.ts` validates one
operation and 1–50 distinct ids/keys; `bulkTriage.ts` runs at most four shared mutations concurrently.
Affected-value guards execute inside every CAS attempt. Status also checks `commentRevision`, a
stable opaque hash covering content and future workflow metadata; only delivery metadata is excluded.
Add verification behavior to the shared status service, preserving this guard and never creating
reviewer confirmation from bulk Done. Receipts retain changed/no-op outcomes; replay reauthorizes
without applying the old desired state. The optional store argument supports isolated failure/race
coverage without replacing process-global stores.

`TriageSelection` snapshots exact visible ids, operation, expected values and keys, clears selection
on scope/view changes, rolls back failures through `CommentUpdates`, retains visible failures and
retries uncertain requests with the same keys. Revalidate once per batch, without router.refresh.
Ordinary public-project enrollment grants no priority or bulk powers; `canTriageProject` is enforced
in services and DTOs. Priority adds activity/integration intent only, with no email event. Read it via
`commentPriority` everywhere. Tests: `triage{,.api}.spec.ts`, MCP, feedback-context and integration
suites. See [review workflow](../../docs/review-workflow.md#search-priority-and-bulk-triage).

## Fix verification

`review/fixVerification.ts` owns conditional request/confirm/reject/cancel transitions. Reuse
`changeComment` and atomic change receipts; recheck mode, access and reviewer authority on each
attempt. `fixVerificationDto.ts` is pure and must be called only after visibility authorization.
`comments/verificationState.ts` is the pure server ordinary-status projection used by review,
public and provider writes; never infer confirmation from a resolved boolean. New requests and
status transitions rotate the request revision. Same-status provider polls preserve readiness.
Keep `verification` bounded to the latest request/decision, with server-only actor references.

`VerificationControl` and toolbar `CommentVerification` share pure `@uier/toolbar/verification`
labels/types, not UI or runtime imports. Ready is a subset of Open in activity counts; board
columns are exclusive. Workflow-only changes must not acknowledge reads. MCP offers approved
request/cancel under `feedback:status`, never confirmation. Keep tools, workflows and downloadable
skill aligned. Focused coverage is `verification{,.api}.spec.ts` plus bulk, MCP and integration
regressions. Author placeholder deletion redacts verification with original author evidence.
