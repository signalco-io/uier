# apps/web - agent guide

The uier.io website and comments API. Next.js 16 App Router, React 19 (React Compiler on),
Tailwind CSS v4 with the signalco minimal theme preset, deployed to Vercel. Runs on
http://localhost:4004 with `pnpm dev` from the repository root.

## Layout

| Path | What |
| --- | --- |
| `app/layout.tsx` | root layout: Geist via `next/font` (`geist` package), metadata and viewport from `@uier/brand`; app and marketing layouts own providers |
| `app/global.css` | Tailwind + UI kit theme + **`@uier/brand/tokens.css`** + shadcn's state variants (`src/styles/shadcn.css`) + `@theme` font and sidebar colour mapping |
| `app/(rest)/(marketing)/` | public pages: `page.tsx` (landing), `brand/page.tsx` (living brand page), `legal/*` (legal documents), `security/page.tsx`, `open-source/page.tsx`, `status/page.tsx`, `layout.tsx` (nav with the section links and Sign in to `/app`, container, footer, clearance for the toolbar) |
| `app/(rest)/(app)/app/` | the app (`/app`): `(auth)/` sign-in and invitation pages (one card), `(shell)/` signed-in pages in the sidebar layout (projects, a project's comments, its settings and install guide, clients, teams, users, workspace settings, account), `connect/` a coding tool's OAuth consent and its public error page (one centred card), `review/[projectId]` review links |
| `src/lib/app/` | app logic: `store.ts` (Cosmos `app` container / in-memory), `model.ts` (documents), `session.ts`, `signIn.ts`, `google/` and `microsoft/` (OIDC sign-in), `passkeys.ts` (passkey sign-in), `context.ts` (user, workspace, role), `projects.ts`, `projectDeletion.ts` (deleting a project and its records), `invitations.ts` (invitations, removing members), `integration.ts` (embed snippets, CSP sources) |
| `src/lib/integrations/` | shared synchronization: source signals/tombstones, bounded discovery, independent leased delivery, provider registry, encrypted credentials/OAuth/grants and member-only link projection; distinct from embed `integration.ts` |
| `src/components/ui/` | the app's [shadcn/ui](https://ui.shadcn.com) components (Base UI, `base-vega` style, `components.json`), source we own |
| `src/components/app/` | app UI: `PageHeader`/`Section` (titled cards), `LinkTabs`, forms and server actions per area (`projects/`, `clients/`, `comments/`, `users/`, `shell/`: sidebar, workspace switcher, account menu, breadcrumbs) |
| `src/lib/comments/submissions.ts` | create/reply receipts: actor/partition scoped, 30-day TTL, content conflicts, atomic Cosmos batch with the write; no text/image in receipts |
| `src/lib/review/`, `app/api/review/` | the review API of a project's toolbar: reviewers (`actor.ts`), project comments and their permissions (`comments.ts`), CORS for the project's sites (`http.ts`), BotID proofs (`verification.ts`), routes |
| `app/review-verification/` | empty, frameable BotID bridge; validates the parent origin on the server and returns a five-minute proof bound to origin, project and reviewer; only this and the session bridge can be framed |
| `app/review-session/`, `app/api/review/[projectId]/sso/` | empty frame and same-origin cookie endpoint for background member sign-in; validate the actual message parent origin against project addresses and recheck membership. Only accepts the separate `review-sso` cookie purpose, never the app cookie; no CORS, no cache, no storage-access prompts |
| `src/lib/email/` | email through Azure Communication Services and the templates |
| `proxy.ts` | exact-path page security headers, request nonces and signed-out `/app/*` redirects (`?next=`) |
| `app/api/comments/route.ts` | comments API (Cosmos DB through `src/lib/db` and `src/lib/repo`) |
| `app/api/mcp/`, `src/lib/mcp/` | the MCP connector: authentication (`credentials.ts`), tools (`server.ts`), prompts, client setup blocks ([MCP connector](#authenticated-mcp-connector)) |
| `app/api/oauth/`, `src/lib/mcp/oauth/` | uier's OAuth authorization server for `/api/mcp` only: authorize, token, register, revoke and the metadata routes that `next.config.ts` rewrites from `/.well-known/`; consent is `/app/connect/<requestId>` |
| `app/api/status/route.ts`, `src/lib/status/` | live service checks for `/status` and monitors ([status reference](../../docs/operations.md#status)) |
| `app/api/visitor/route.ts` | the anonymous visitor: guest name (`GET`) and sign out (`DELETE`) |
| `app/api/rewrite/route.ts`, `src/lib/rewrite/` | AI rewrite suggestions for selected text (Anthropic SDK; `503` without `ANTHROPIC_API_KEY`; the e2e tests use `e2e/support/anthropicStub.ts`) |
| `app/manifest.ts`, `app/opengraph-image.tsx` | web manifest and social card, generated from brand constants |
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
review layer is shown with persisted starter threads (the toolbar renders `data-uier-thread` slots, pins and highlights), one solid
"Get started" and one outlined secondary action, no badges above the headline. The cover beside the
headline is the how-it-works scene (`HowItWorks`); the headline thread's live slot is in "Try it on
this page", and the description stays a direct child of the hero's first column (tests select it as
`main>section>div>p`).

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
blocks and `src/lib/integrations/catalog.ts` for actual provider capabilities and setup steps.
Listing illustrations come from `scripts/render-integration-listings.mjs`, existing brand vectors
and Geist fonts. They contain no customer data and are labelled illustrations. Keep permissions,
privacy limits and directory status aligned with the adapters and `docs/integration-publication.md`.
`e2e/integration-pages.spec.ts` covers the public guides, support/setup links and accessibility.

## Search indexing

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
dynamic. `@vercel/analytics` 2.0.1 uses same-origin `/_vercel/insights/script.js` in production;
only development permits `va.vercel-scripts.com`. Vercel toolbar/frame/Pusher hosts apply only to
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
  settings, which has no sidebar entry of its own), active projects with
  All projects and Create project icon links in their header, then at the bottom the sections (Clients when a
  visible project has a client; Teams and Users for admins), Give feedback and the account menu), the inset
  panel with the breadcrumbs (`AppBreadcrumbs`, from the path) and the one invite dialog
  (`InviteProvider`; `InviteButton` and `useInvite()` open it). A project's header is
  `projects/[projectId]/layout.tsx` (client, then who can comment, whose popover has Invite for admins; no tabs:
  Settings is an icon button after Open review); its pages
  render the comments, settings or onboarding install step under it.
- **Project settings** are sections, each its own page under `settings/` (`settings/layout.tsx`): General (the
  settings page itself), Review, Environments, Installation, People and teams, Integrations, Notifications and
  Danger zone, listed by `projectSettingsSections` and linked with `KnownPageLinks.projectSettings(id, section)`.
  The layout shows them as `LinkTabs` `side` (a column beside the section, a row above it on small screens) and
  the breadcrumbs end with the section. `settingsContext.ts` loads the viewer and project once per request;
  admin-only sections call `configurableProject` (404 for commenters and the uier workspace). Commenters see
  Installation and Notifications, and the settings page redirects them to Notifications. Integrations is a grid of
  the services not connected yet (logo, one line, Connect, Details) above the connected ones, each a row with its
  destination and status badge; every service has its own page, `settings/integrations/<provider>`
  (`KnownPageLinks.projectIntegration`), with the provider's section: destination, sync controls and privacy limits.
  `components/app/integrations/projectIntegrations.ts` lists the services and computes the status badges both pages
  show. Connect/callback routes return to the provider's page (`?github=connected`); actions revalidate it and the
  overview (`revalidateIntegration`). The settings tabs keep Integrations current on those pages (`nested`). `install` without
  `?onboarding=1` redirects to Settings → Installation (the toolbar still links there).
- Comment cards (`comments/CommentCard.tsx`) are laid out like the toolbar's thread
  (`packages/toolbar`, `CommentThread*.tsx`), with the same icons (Lucide `Copy`, `Link2`, `Mail`)
  and words: state, `#number`, unread dot and the assignee (their avatar, or the user icon while unassigned; the tooltip
  says "Unassigned" / "Assigned to ...") with the actions on one row
  (`ThreadAction`: icon-only with a tooltip and accessible name). The unread dot is the Mark as read button
  ("Unread. Mark as read"). For those who can resolve, the state badge is the Open/Done menu ("Status: Open.
  Change status"); Copy link, Follow thread / Unfollow thread and, once read, Mark as unread are in the More
  actions menu. Then the first and last message with Show all, the quiet Open in ...,
  and the page link in the footer, with the source's environment name (or why the original source is
  unavailable) at its right; an address that only repeats the link's origin is left out. The toolbar's
  header still has its icon Done/Reopen and Copy link: change both together where they match. The first
  message's time is followed by `CommentDevice`: screen size and browser icons whose popover (hover or
  click, `hoverPopoverTrigger` for Base UI's `openOnHover`, like the project header's access info) lists
  the reproduction context and copies its text; the toolbar still shows one device icon with details
  under the message. Copy issue confirms "Issue copied." in its tooltip under the button
  (`ThreadAction`'s `notice`) for 2 seconds, as the toolbar does; its errors and manual clipboard
  fallback stay in the body; pending actions show `Spinner`.
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
  guide (onboarding always shows the guide).
- The comments' filter row: status tabs, Unread and Mark all as read, then one Environment and page control
  (`LocationFilter`: environments on the left, the chosen environment's pages on the right with a search,
  sections such as `/blog/*` and "Pages under" a typed path, matched by `pageFilter.ts`) and People, then the
  count and List/Board on the right. Choosing an environment keeps the panel open and reloads its pages.
- `app/global.css` defines `--radius-sm/md/lg` (the preset's radii are JS values with no variables);
  shadcn's small buttons read `var(--radius-md)`.
- **Onboarding.** `OnboardingSteps` shows Your site, Add the script and Invite a reviewer. Only
  `install?onboarding=1` adds `InviteReviewerStep` below the unchanged install guide. Invited-only projects
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
  Clients page, the sidebar link, the suggestions, the filter, cards and the project header). The filter
  value is the client id (`?client=<id>` or `none`); old `name:<name>` links redirect to it. The client
  field (`ClientNameInput`) is free text that suggests existing clients: it is built on
  `src/components/ui/autocomplete.tsx`, Base UI's Autocomplete styled like shadcn's Combobox (shadcn has
  no autocomplete, and Combobox only takes one of its items). Admins edit a client in `ClientEditDialog`
  on the Clients page (`updateClientAction`). Client data belongs to the signed-in app: `reviewProjectDto`
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
- `@uier/toolbar/page-state` is the shared pure URL contract. Projects opt in through `ProjectPageStateForm`; the
  review API filters submitted paths using that policy and marks new records `pageStateVersion: 1`. Store queries
  match v1 keys exactly; the legacy query-string prefix fallback must never merge v1 views into a base page.
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
  `sessionSignedInAt`, checked at the start and again at the callback) and unlinks; a `sub` of another user is refused. The button shows only in
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
  and never changes the uier email. Account can link/unlink one Microsoft identity. Production/local
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
- The sign-in card (`sign-in/SignInForm.tsx`) lists every option as the same outline `Button size="lg"` with
  only the method's name (Passkey, Google, Microsoft, then Email, the last resort) under "Choose how to sign
  in."; each button's `aria-label` is "Sign in with ...", which the tests look up. The email option is a link
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
`rewrite-accounting.api.spec.ts` and `rewriteFixtures.ts` cover accounting without paid calls. Live
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
are `/app/teams`, `/app/teams/[teamId]`, `/app/users/[userId]`. Admin previews must reject stale
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
The scheduled job supplies `UIER_COMMENTS_SECRET` from its repository secret because Vercel omits
Sensitive values from downloads. Keep that copy aligned with the existing production key; never
replace the app key to repair a worker. The email settings come from the download, so
`ACS_CONNECTION_STRING` stays retrievable; without both, a run skips email delivery (ledgers stay
queued with their failure budget) and fails. `integrations_only` manual runs must skip email delivery
and reject a simultaneous email retry. GitHub Settings can reuse installations known to the current
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
  install those engines first. `launch-performance.spec.ts` attaches the 100-thread measurements.
  Keep `docs/mvp-launch-verification.md` honest about pending dependency, hosted and physical-device
  evidence; passing local fixtures alone must not close the launch gate.
- Locally the comments API keeps comments in memory; `COSMOSDB_CONNECTION_STRING` in `.env.local`
  points it at a real Cosmos DB. Deployments get their Cosmos DB settings and `UIER_COMMENTS_SECRET`
  from Pulumi: production an account key, previews Entra ID with the Vercel OIDC token
  (`src/lib/db/client.ts`), scoped to the `comments-preview` container.

## Toolbar in development

`ClientProvider` loads http://localhost:4005/index.js in development only. Open any page with a
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

- `src/lib/app/environments.ts` owns origin labels, explicit alias groups and historical-source
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
with `The operation failed.` and a generic log line. Never return raw storage diagnostics.
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

`src/lib/extension` and `/api/extension` use separate revocable eight-hour sessions and five-minute
project/exact-origin credentials. UIER_EXTENSION_CLIENT_IDS is an explicit allowlist; disabled by
default. It grants transport/registration only, never identity or BotID bypass. Recheck current
membership, session and addresses before calling shared review services. Keep embed CORS unchanged.
`/app/extension` is explicit consent after first-party sign-in. `/extension-verification` is a
nonce-protected frame for the packaged helper; only registered extension origins may frame it.
No app cookie reaches the worker. Read [the design and remaining gates](../../docs/browser-extension.md).


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
