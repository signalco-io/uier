# apps/web - agent guide

The uier.io website and comments API. Next.js 16 App Router, React 19 (React Compiler on),
Tailwind CSS v4 with the signalco minimal theme preset, deployed to Vercel. Runs on
http://localhost:4004 with `pnpm dev` from the repository root.

## Layout

| Path | What |
| --- | --- |
| `app/layout.tsx` | root layout: Geist via `next/font` (`geist` package), metadata and viewport from `@uier/brand`, providers |
| `app/global.css` | Tailwind + UI kit theme + **`@uier/brand/tokens.css`** + shadcn's state variants (`src/styles/shadcn.css`) + `@theme` font and sidebar colour mapping |
| `app/(rest)/(marketing)/` | public pages: `page.tsx` (landing), `brand/page.tsx` (living brand page), `legal/*` (legal documents), `security/page.tsx`, `open-source/page.tsx`, `status/page.tsx`, `layout.tsx` (nav with the section links and Sign in to `/app`, container, footer, clearance for the toolbar) |
| `app/(rest)/(app)/app/` | the app (`/app`): `(auth)/` sign-in and invitation pages (one card), `(shell)/` signed-in pages in the sidebar layout (projects, a project's comments, install and settings tabs, clients, users, account), `review/[projectId]` review links |
| `src/lib/app/` | app logic: `store.ts` (Cosmos `app` container / in-memory), `model.ts` (documents), `session.ts`, `signIn.ts`, `context.ts` (user, workspace, role), `projects.ts`, `invitations.ts` (invitations, removing members), `integration.ts` (embed snippets, CSP sources) |
| `src/components/ui/` | the app's [shadcn/ui](https://ui.shadcn.com) components (Radix, `radix-vega` style, `components.json`), source we own |
| `src/components/app/` | app UI: `PageHeader`/`Section` (titled cards), `LinkTabs`, forms and server actions per area (`projects/`, `comments/`, `users/`, `shell/`: sidebar, workspace switcher, account menu, breadcrumbs) |
| `src/lib/comments/submissions.ts` | create/reply receipts: actor/partition scoped, 30-day TTL, content conflicts, atomic Cosmos batch with the write; no text/image in receipts |
| `src/lib/review/`, `app/api/review/` | the review API of a project's toolbar: reviewers (`actor.ts`), project comments and their permissions (`comments.ts`), CORS for the project's sites (`http.ts`), BotID proofs (`verification.ts`), routes |
| `app/review-verification/` | empty, frameable BotID bridge; validates the parent origin on the server and returns a five-minute proof bound to origin, project and reviewer; only this and the session bridge can be framed |
| `app/review-session/`, `app/api/review/[projectId]/sso/` | empty frame and same-origin cookie endpoint for background member sign-in; validate the actual message parent origin against project addresses and recheck membership. Only accepts the separate `review-sso` cookie purpose, never the app cookie; no CORS, no cache, no storage-access prompts |
| `src/lib/email/` | email through Azure Communication Services and the templates |
| `proxy.ts` | sends signed-out visitors of `/app/*` to sign in (`?next=`) |
| `app/api/comments/route.ts` | comments API (Cosmos DB through `src/lib/db` and `src/lib/repo`) |
| `app/api/status/route.ts`, `src/lib/status/` | live service checks for `/status` and monitors (README "Status") |
| `app/api/visitor/route.ts` | the anonymous visitor: guest name (`GET`) and sign out (`DELETE`) |
| `app/api/rewrite/route.ts`, `src/lib/rewrite/` | AI rewrite suggestions for selected text (Anthropic SDK; `503` without `ANTHROPIC_API_KEY`; the e2e tests use `e2e/support/anthropicStub.ts`) |
| `app/manifest.ts`, `app/opengraph-image.tsx` | web manifest and social card, generated from brand constants |
| `app/not-found.tsx`, `app/(rest)/error.tsx` | the 404 page and the error boundary, both a `StatusPage` (`src/components/StatusPage.tsx`: logo, a browser frame with a pin on the empty spot, what happened, where to go) |
| `src/components/marketing/` | `ContentPage` (the building blocks of every public page, landing included: header with a one-sentence lead, section heading, section (heading beside its content on wide screens, like the landing's questions; `wide` stacks them, for the brand page's specimens), `Panel` of hairline-divided cells with `Tile`, `CheckList`, `InlineLink`), `HowItWorks` (the landing's cover: one animated loop on the example site from adding the script tag to a thread marked as done, under a row with its heading, a caption and Pause), `LandingSpecimens` (static, `aria-hidden` pictures of the review layer and the app for the landing's feature tiles; example content is an imaginary restaurant site, a different part of it than the walkthrough shows), `LandingPricing`, `LandingFaq`, `SiteFooter` (the footer of every public page; `Footer1` vendored from signalco renders it), `ReviewThreadDemo` (a visual specimen on `/brand`; the landing thread is live) |
| `src/components/legal/` | `LegalDocument`: legal navigation, title, effective date and the text styles of every legal page |
| `src/components/brand/` | client helpers for the brand page (`ThemeToggle`, `TokenSwatch`, `ToolbarIllustration`) |
| `src/knownPages.ts` | every route the site links to; add new pages here |
| `src/lib/secureHeaders.ts`, `next.config.ts` | CSP and security headers (Google Fonts and Vercel are the only external origins) |
| `e2e/` | Playwright tests (landing, brand page, headers, axe accessibility, the toolbar on another origin) |
| `public/` | icons rendered by `pnpm -C packages/brand icons`, `favicon.svg` copied from `packages/brand/assets` |

## Styling rules

- Use the UI kit's semantic utilities: `bg-background`, `text-foreground`, `text-muted-foreground`,
  `text-secondary-foreground`, `border-border` (`border` alone), `bg-muted`, `bg-primary`.
  Brand-only tokens are `hsl(var(--brand-accent))`, `--brand-accent-text`, `--brand-selection`,
  `--brand-success`, `--brand-warning`. No raw hex in components (the two dark/light logo panels
  on the brand page are the deliberate exception: they must stay black and white in both themes).
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

## Footer

Every public page gets `SiteFooter` from the marketing layout; pages do not render their own.
Contact and social destinations come from `brand.contact` / `brand.social` in `@uier/brand`
(signalco's addresses and X account: uier has none of its own), routes from `src/knownPages.ts`.
Labels are sentence case. `e2e/footer.spec.ts` checks the footer on every public page and its links.

## Legal documents

`/legal/privacy-policy`, `/legal/terms-of-service`, `/legal/cookie-policy`,
`/legal/acceptable-use-policy` and `/legal/sla` describe what the site actually does: what the
comments API stores, the `uier_visitor` cookie, rate limits, BotID, Vercel Web Analytics, where data
is stored and for how long. When you change any of that (a new cookie or storage key, a new
third party, a different retention), update the matching document and its effective date in the
same pull request. The SLA states that there are no service commitments; do not add uptime targets
or credits before they are decided. `e2e/legal.spec.ts` checks each document, the legal navigation
and the footer links.

## Security and open source pages

`/security` lists only controls that are in place and can be checked in this repository; remove a
control from it when it stops being true, and add one only when it ships. `/open-source` mirrors the
licenses in each `package.json`, the root `LICENSE` and the README "License" section. Both have the
repository's `SECURITY.md` and `CONTRIBUTING.md` as counterparts; keep them saying the same thing.
`e2e/pages.spec.ts` checks them.

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
  (BRAND.md). Icons come from `lucide-react` (1.75 stroke, set in the theme). Toasts are `sonner`
  (`toast()`), mounted with the tooltip provider in the app layout.
- **Layout.** `(shell)/layout.tsx` is the sidebar (`AppSidebar`: workspace switcher, active projects with
  All projects and Create project icon links in their header, then at the bottom the sections (Clients when a
  visible project has a client, Users for admins), Give feedback and the account menu), the inset
  panel with the breadcrumbs (`AppBreadcrumbs`, from the path) and the one invite dialog
  (`InviteProvider`; `InviteButton` and `useInvite()` open it). A project's header and tabs are
  `projects/[projectId]/layout.tsx`; its pages render the tab content.
- Comment cards keep Copy issue as an icon-only action in the top-right header, with an accessible
  name and title; its status and manual clipboard fallback stay in the body. Follow and reproduction
  actions, browser context and assignee pair decorative Lucide icons with visible labels. Action
  buttons use the app's shadcn `Button` with `data-icon`; pending follow/copy actions show `Spinner`.
- **Onboarding.** `OnboardingSteps` shows Your site, Add the script and Invite a reviewer. Only
  `install?onboarding=1` adds `InviteReviewerStep` below the unchanged install guide. Invited-only projects
  use the shell's `InviteButton` with `projectId`, gated by `context.isAdmin`; the empty comments list does
  the same. Guest projects reuse `GuestReviewLinks` for every configured address in order (main site first),
  in onboarding or the comments page's Guest link region, never again in its empty state. Copy fields use
  plain `reviewUrl` links, never `/app/review`, `uier-token` or `uier-check`. Comments-off states explain that
  comments are off and link admins to Settings; their header has no Invite. `inviteAction` still checks the
  admin role on the server. `e2e/app.spec.ts`, `project-review.spec.ts` and `users.spec.ts` cover these paths.
- Project addresses use `normalizeSiteUrl` in `src/lib/app/projects.ts`: schemeless localhost,
  `.localhost` subdomains and loopback IPs default to HTTP, other hosts to HTTPS. Explicit schemes
  and ports are preserved. Review CORS and redirects still require an exact configured origin.
- Client names are optional project labels (`clientName`), not address/environment configuration or client entities.
  `projectClientNameSchema` collapses whitespace and clears blank input; the shared limit is 80 characters.
  The list builds client choices only after `listVisibleProjects` and preserves the client/status query filters.
  `src/lib/app/clients.ts` derives clients (the Clients page, the sidebar link and the suggestions) from visible
  projects the same way. The client field (`ClientNameInput`) is free text that suggests existing clients: it is
  built on `src/components/ui/autocomplete.tsx`, Base UI's Autocomplete styled like shadcn's Combobox (shadcn
  has no autocomplete, and Combobox only takes one of its items).
  Client names belong to the signed-in app, not the public review project DTO.
- Every server action checks the session and the role itself (`appContextOrThrow({ admin })`); pages use
  `requireAppContext()` / `requireAdminContext()`. Never trust ids from the form without loading the
  document from the current workspace.
- Apart from uier's own public feedback project, which every account joins (`joinPublicProject`), a
  membership is only ever created by an invitation or together with a new workspace (`ensureOwnWorkspace`,
  one `createAll` transaction). Never recreate a missing member document of a customer workspace: a missing
  member is someone an admin removed, and recreating it undoes the removal (their review tokens and MCP
  credentials work again). `e2e/workspaces.api.spec.ts` and the users e2e tests cover it.
- Forms use `useActionState` with `actionResult()` (expected failures become `{ ok: false, error }`)
  and controlled inputs, so React's reset after an action never drops what was typed.
- Message edits through the review API compare `expectedText` before changing a thread item; author/admin
  permission checks and etag retries preserve concurrent replies. `editedAt` is shown in the toolbar and app.
- Saved image replacements use `POST .../comments/<id>/screenshot` with shared screenshot validation,
  the daily image budget and `expectedRevision`. `replaceScreenshot.ts` checks visibility/edit rights
  on each attempt; stores atomically swap comment metadata and image bytes under the comment etag.
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
- Links the app sends or redirects to come from `appBaseUrl()` (requests) or its shared pure
  `configuredAppBaseUrl()` helper (scheduled workers), never from an untrusted Host header.
- Sign-in emails contain a link and an eight-digit numeric code, sharing the same 15-minute request and
  atomic delete in `signIn.ts`. The code requires the signed HttpOnly `uier_sign_in_request` cookie;
  a newer request replaces the binding, and `startSession` clears it. Use `appCookieOptions` for the
  binding (SameSite=Lax, Secure outside local runtime). Store only the request-specific keyed code hash
  and compare in constant time. Never put codes in URLs, subjects or logs. Both atomic guess counters
  start at the request's creation time; reserve before comparing, invalidate on the fifth wrong guess.
  Keep the email budgets (5/address, 20/IP/hour). Invitations remain link-only. All invalid codes share
  one message; a foreign binding spends none of the original request's budget.
- Locally (`UIER_LOCAL=1` or `next dev`) and on previews no email is sent; pages show the link and code.
  The e2e helpers in `e2e/support/app.ts` sign in with the code. `e2e/sign-in.api.spec.ts` covers expiry,
  concurrency, binding validation, code-email safety and lifetime budgets; `app.spec.ts` and
  `project-review.spec.ts` cover browser isolation, accessibility and the toolbar's return path.

## Testing

CSP console audits must be asserted before an axe scan. Axe fetches external stylesheets with
`fetch`, which can produce scanner-only `connect-src` violations on a strict reviewed site.
Start a fresh audit for subsequent product actions; retain the strict policy and assertions.

Review notifications live in `src/lib/notifications/`. Event metadata is part of the same comment
write as the shared unread activity cursor. Never send email from a toolbar client or detached
promise. The scheduled `Review notifications` workflow runs the awaited Cosmos-backed worker with
the existing production configuration. Dispatch rechecks access, private visibility, subscription,
mute and `getReadSequence`; keep the optional verified guest flow separate from posting. See
`docs/review-notifications.md` for the event/delivery contract and failure evidence.
`/api/email/reports` checks its secret header, expected Event Grid subscription and ACS topic before
validation or writes. Validation can use the configured ACS resource topic or its Azure
subscription root (the documented Event Grid handshake); delivery reports must use the ACS topic.
Keep the exact event-subscription name and credential mandatory for both. Bounces suppress only by normalized address hash and bounded reason; report
receipts retain hashed event/operation ids for 30 days and survive a mailbox confirmation. No raw
provider message, address or report payload may be logged. Skip suppressed digests; a failed read
must retry. Show the generic notice only in the admin invite action. Requested sign-in/guest
confirmation remain available and clear suppression only on completed mailbox proof. Ledger
matching is production-gated until live message-id correlation is proven.
Digest unsubscribe headers are persisted in `attempt.message.headers`; retries preserve them.
`/api/notifications/unsubscribe` changes state only on a cookie-free RFC 8058 POST; GET and
`/notifications` remain read-only. Never accept verify tokens for unsubscribe/mute.
Digest wording uses only the recipient's eligible batch and current authorized participant names;
never name other mention/assignment recipients. Events store item/new-assignee ids, never text.
`emailCommentExcerpts` defaults off and is saved through `adminProject`; commenters see its state.
New attempts rebuild from fresh settings/items at the send boundary; retained provider operations
keep their exact message, which can retain opt-in excerpts until reconciliation without a TTL.

- `pnpm typecheck` (runs `next typegen` first), `pnpm build`, then `pnpm test` (Playwright
  against `next start` on `PORT`, default 4004, e.g. `PORT=4104 pnpm test`; API, Desktop and
  Mobile Chrome). A server that already answers on that port is never reused (the run fails), so
  stop `pnpm dev` or pick another `PORT`. Rewrite suggestions go to `e2e/support/anthropicStub.ts`
  on `PORT + 1000`, never to the real API.
- Accessibility is part of the suite: new pages should be added to an `assertAccessibility`
  test. Keep text at 4.5:1 or better (`text-muted-foreground` is the lightest text colour).
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

`app/layout.tsx` loads http://localhost:4005/index.js in development only. Open any page with a
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

Every account joins `w_uier_public` as a commenter scoped to the feedback project. Provisioning
backfills existing accounts with a durable receipt; account creation/sign-in and app context ensure
membership afterwards without email invitations. Preserve existing admins and the user's selected
workspace; this membership must not suppress their own workspace/onboarding. On the public project's
same-origin comments API, `uier_session` takes precedence over guest identity. Store `user:<id>` just
as the review API does, resolve current account names for DTOs, and keep private app feedback
author-only in the public API. Guest comments are not automatically reassigned on sign-in.

Assignment eligibility lives in `review/participants.ts` and is rechecked inside optimistic
comment mutations. Mentions store selected account ids with UTF-16 text ranges; review DTOs
expose identity metadata only to members. App and toolbar must share these checks.

- `src/lib/comments/activity.ts` and `readState.ts` own thread activity and reviewer read cursors.
  Read acknowledgements require current project/thread access and acknowledge only a rendered
  sequence. Toolbar and app use the same member cursor; notifications must reauthorize before
  reading it for suppression. Do not equate resolution with read state or expose actor ids in DTOs.
  Bulk acknowledgement uses `comments/bulkRead.ts` and `review/bulkRead.ts`: validate every id/cursor
  before writes, at most 200 threads/48 KiB per request and four concurrent cursor writes. Review
  routes retain verified-write protection; public routes retain BotID. Return only successful activity
  receipts, skip missing/hidden/failed threads without reasons, and reauthorize each project thread.
  App list/board actions snapshot the shown unread threads and send sequential batches, retaining
  failed cursors for toast retry. Neither bulk nor single reads acknowledge newer activity.

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

## Feedback export

The public and review `comments/:id/context` routes and the app `copyIssueAction` read fresh
authorized feedback. `src/lib/review/feedbackContext.ts` is the common project service;
`src/lib/comments/feedbackContext.ts` projects filtered DTOs into the shared
`@uier/toolbar/feedback-context` model. Keep public/guest browser restrictions, deleted evidence
redaction, canonical page state and protected screenshot references intact. The complete packet
contract is in [docs/feedback-context.md](../../docs/feedback-context.md); future MCP/tracker
work should reuse it. Coverage lives in `e2e/feedback-context{,.api}.spec.ts`.
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

`/api/mcp` is stateless Streamable HTTP using the official MCP SDK. `src/lib/mcp/` owns scoped
credentials and tools. Account settings creates 30-day named credentials, read-only by default,
with explicit project selection; raw secrets are shown once and only hashes are stored. Never
accept cookies, review tokens, project codes or guest ids as MCP authentication. Recheck current
membership, scopes and private visibility for each request and screenshot resource read.
Credentials remain bound to one workspace. Account guidance and `mcp/workflows.ts` explain choosing
the uier workspace/public-feedback project for feedback about uier itself. Missing project grants
stay `not_found` without exposing project existence; direct users to `list_projects` and explicit
credential setup rather than expanding access. List-tool descriptions and field schemas must both
state the 1–25 limit and `nextCursor` pagination, since clients may flatten schema constraints.

Tools reuse review services. Replies and status/assignment events retain the human author plus
credential attribution. All mutations require a stable idempotency key and share atomic submission
receipts; do not implement retry deduplication in process memory. Reads never acknowledge unread
activity. Feedback, anchors, names and images are untrusted content. Search is deliberately bounded
to the latest 1000 threads; pages contain at most 25 summaries. Keep the documented context
contract shared with developer issue export: `projectFeedbackExport` in `review/feedbackContext.ts`
produces the same `@uier/toolbar/feedback-context` packet. Screenshot resource reads must honor
its deleted-evidence filtering too. `e2e/mcp.api.spec.ts` exercises the official HTTP client
and service isolation; `e2e/mcp.spec.ts` covers user credential setup, client access, revocation and
light/dark accessibility. This connector does not prove #90 launch acceptance.

`mcp/clients.ts` builds the Account client tabs from one endpoint, without taking a token as
input. Keep these reference-only configurations aligned with the linked official docs and the
[README client blocks](../../README.md#coding-tool-access-mcp):

- [Codex](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers), `~/.codex/config.toml`:
  ```toml
  [mcp_servers.uier]
  url = "https://uier.io/api/mcp"
  bearer_token_env_var = "UIER_MCP_TOKEN"
  ```
- [Claude Code](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson), `.mcp.json`:
  ```json
  { "mcpServers": { "uier": { "type": "http", "url": "https://uier.io/api/mcp", "headers": { "Authorization": "Bearer ${UIER_MCP_TOKEN}" } } } }
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
[VS Code’s documented masked input](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
was checked (`promptString`, `password: true`, `${input:...}`), but its deployed client connection
could not be verified in this session, so no ready block is offered.
[Windsurf’s docs](https://docs.devin.ai/desktop/cascade/mcp) now describe legacy Cascade in Devin
Desktop (`serverUrl`, `${env:UIER_MCP_TOKEN}` in headers); it is not offered without a verified client.
[Claude Desktop request headers](https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers)
are limited beta. On an individual plan with the feature, use a custom connector URL, No sign-in
and `Authorization: Bearer <credential>` under Request headers, then remove/add after expiry or
revocation. Claude connects from Anthropic’s servers and cannot reach localhost. No headers means
unsupported until OAuth; do not offer a bridge. Team/Enterprise are unsupported because an Owner
adds connectors for the organization and a personal credential must not be shared.

`mcp/prompts.ts` registers `triage-feedback` (`projectId`), `fix-feedback` and `report-back`
(`projectId`, `commentId`). Share identifier schemas with tools in `mcp/schemas.ts`. Recheck
`mcpProject` even when rendering instructions; never echo failed arguments or embed feedback.
Report-back is registered only for reply/status grants and names only the permitted writes.
`mcp/workflows.ts` is the common source for prompt instructions, the untrusted-content rule and
the copy/download `SKILL.md` in Coding agents. Keep the tool/scope table aligned with the server.
Triage changes nothing, fix proposes local code work only, and report-back waits for human approval
before every write. The skill also requires approval for assignments and stable retry keys.

`list_feedback` shares path, source, assignment and activity projection with the app through
`app/projectCommentRouting.ts`. Canonicalize its optional path with `pagePath`; pass path and
`environmentFilter` into `listProjectComments` before the 1000-thread storage limit. Validate
environment ids against `environmentOptions` plus `unknown`/`removed`; never use the toolbar's
fallback selection for MCP input. Other filters apply only within that window. Read the credential
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
per-credential/project budget, then the owner's budget; rejected credentials must not exhaust the
owner. Page, screenshot, paid rewrite and MCP transport limits stay independent. Coverage is in
`review-rate-limits.api.spec.ts`, `public-project.api.spec.ts`, `mcp.api.spec.ts` and the unchanged
`comments.api.spec.ts` rate cases.
