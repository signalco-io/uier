# apps/web - agent guide

The uier.io website and comments API. Next.js 16 App Router, React 19 (React Compiler on),
Tailwind CSS v4 with the signalco minimal theme preset, deployed to Vercel. Runs on
http://localhost:4004 with `pnpm dev` from the repository root.

## Layout

| Path | What |
| --- | --- |
| `app/layout.tsx` | root layout: Geist via `next/font` (`geist` package), metadata and viewport from `@uier/brand`, providers |
| `app/global.css` | Tailwind + UI kit theme + **`@uier/brand/tokens.css`** + shadcn's state variants (`src/styles/shadcn.css`) + `@theme` font and sidebar colour mapping |
| `app/(rest)/(marketing)/` | public pages: `page.tsx` (landing), `brand/page.tsx` (living brand page), `legal/*` (legal documents), `security/page.tsx`, `open-source/page.tsx`, `status/page.tsx`, `layout.tsx` (nav, container, footer, clearance for the toolbar) |
| `app/(rest)/(app)/app/` | the app (`/app`): `(auth)/` sign-in and invitation pages (one card), `(shell)/` signed-in pages in the sidebar layout (projects, a project's comments, install and settings tabs, users, account), `review/[projectId]` review links |
| `src/lib/app/` | app logic: `store.ts` (Cosmos `app` container / in-memory), `model.ts` (documents), `session.ts`, `signIn.ts`, `context.ts` (user, workspace, role), `projects.ts`, `invitations.ts` (invitations, removing members), `integration.ts` (embed snippets, CSP sources) |
| `src/components/ui/` | the app's [shadcn/ui](https://ui.shadcn.com) components (Radix, `radix-vega` style, `components.json`), source we own |
| `src/components/app/` | app UI: `PageHeader`/`Section` (titled cards), `LinkTabs`, forms and server actions per area (`projects/`, `comments/`, `users/`, `shell/`: sidebar, workspace switcher, account menu, breadcrumbs) |
| `src/lib/review/`, `app/api/review/` | the review API of a project's toolbar: reviewers (`actor.ts`), project comments and their permissions (`comments.ts`), CORS for the project's sites (`http.ts`), BotID proofs (`verification.ts`), routes |
| `app/review-verification/` | empty, frameable BotID bridge; validates the parent origin on the server and returns a five-minute proof bound to origin, project and reviewer; all other pages remain unframeable |
| `src/lib/email/` | email through Azure Communication Services and the templates |
| `proxy.ts` | sends signed-out visitors of `/app/*` to sign in (`?next=`) |
| `app/api/comments/route.ts` | comments API (Cosmos DB through `src/lib/db` and `src/lib/repo`) |
| `app/api/status/route.ts`, `src/lib/status/` | live service checks for `/status` and monitors (README "Status") |
| `app/api/visitor/route.ts` | the anonymous visitor: guest name (`GET`) and sign out (`DELETE`) |
| `app/api/rewrite/route.ts`, `src/lib/rewrite/` | AI rewrite suggestions for selected text (Anthropic SDK; `503` without `ANTHROPIC_API_KEY`; the e2e tests use `e2e/support/anthropicStub.ts`) |
| `app/manifest.ts`, `app/opengraph-image.tsx` | web manifest and social card, generated from brand constants |
| `src/components/marketing/` | `ContentPage` (header, section and tile of the content pages), `LandingPricing`, `LandingFaq`, `SiteFooter` (the footer of every public page; `Footer1` vendored from signalco renders it), landing sections (`ReviewThreadDemo` remains a visual specimen on `/brand`; the landing thread is live) |
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
"Get started" and one outlined secondary action, no badges above the headline.

Sections, in order, each with an `h2` whose id the navigation and footer link to (`KnownPages`):
how it works (`#how-it-works`), features (`#features`), get started (`#get-started`), pricing
(`#pricing`, `LandingPricing`) and questions (`#faq`, `LandingFaq`, native `<details>`).

- **Only what the toolbar does today.** Every step, feature and answer describes behaviour you can
  try on the page (check `packages/toolbar` before adding one). The showcase runs on every public
  marketing page and its inbox includes other public pages. Project
  embeds work on their configured addresses, with headers for identity and BotID proofs for writes.
- **Get started** goes to `#get-started`, which starts the one supported flow: leaving a comment
  with the showcase toolbar on this page. Point it at the app (and update the test) once
  onboarding exists.
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

- **UI: shadcn/ui.** The app (`app/(rest)/(app)`) is built from the components in `src/components/ui`,
  added with `pnpm dlx shadcn@latest add <name>` (run in `apps/web`; the shadcn skill in
  `.claude/skills/shadcn` has the rules: `Field` for forms, `Empty` for empty states, `Badge`, `Item`,
  icons with `data-icon`). After adding a component, check the diff: the CLI may write oklch colour
  variables or a `@theme inline` block into `app/global.css`, which must not land. Colours stay HSL
  triplets in `@uier/brand/tokens.css` (the theme preset wraps them in `hsl()`), so a component that uses
  a raw `var(--x)` as a colour needs `hsl(var(--x))`. Resting surfaces get a border, not a shadow
  (BRAND.md). Icons come from `lucide-react` (1.75 stroke, set in the theme). Toasts are `sonner`
  (`toast()`), mounted with the tooltip provider in the app layout.
- **Layout.** `(shell)/layout.tsx` is the sidebar (`AppSidebar`: workspace switcher, sections, active
  projects, account menu) and the inset panel with the breadcrumbs (`AppBreadcrumbs`, from the path). A
  project's header and tabs are `projects/[projectId]/layout.tsx`; its pages render the tab content.
- Every server action checks the session and the role itself (`appContextOrThrow({ admin })`); pages use
  `requireAppContext()` / `requireAdminContext()`. Never trust ids from the form without loading the
  document from the current workspace.
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
- Links the app sends or redirects to come from `appBaseUrl()`, never from the Host header.
- Locally (`UIER_LOCAL=1` or `next dev`) no email is sent; pages show the link instead. The e2e
  helpers in `e2e/support/app.ts` sign in that way.

## Testing

- `pnpm typecheck` (runs `next typegen` first), `pnpm build`, then `pnpm test` (Playwright
  against `next start` on `PORT`, default 4004, e.g. `PORT=4104 pnpm test`; API, Desktop and
  Mobile Chrome). A server that already answers on that port is never reused (the run fails), so
  stop `pnpm dev` or pick another `PORT`. Rewrite suggestions go to `e2e/support/anthropicStub.ts`
  on `PORT + 1000`, never to the real API.
- Accessibility is part of the suite: new pages should be added to an `assertAccessibility`
  test. Keep text at 4.5:1 or better (`text-muted-foreground` is the lightest text colour).
- Locally the comments API keeps comments in memory; `COSMOSDB_CONNECTION_STRING` in `.env.local`
  points it at a real Cosmos DB. Deployments get their Cosmos DB settings and `UIER_COMMENTS_SECRET`
  from Pulumi: production an account key, previews Entra ID with the Vercel OIDC token
  (`src/lib/db/client.ts`), scoped to the `comments-preview` container.

## Toolbar in development

`app/layout.tsx` loads http://localhost:4005/index.js in development only. Open any page with a
review link, `?review=true` or `?toolbar-code=<project code>` (for example `/brand?review=true`), to
see the real toolbar on top of it. uier.io's public marketing layout embeds showcase mode on every page, using the same-origin cookie API
backed by the static project `uier00000001`. `src/lib/comments/publicProject.ts` provisions its workspace,
project and permanent starter threads on first use, and copies legacy production feedback once. New
visitor threads expire after 90 days; starter threads and their replies do not expire. Local subdomains
retain independent host partitions for tests. On a project's site the
script's `data-uier-project` decides the project, and `?review=true` there reviews that project
(`e2e/project-review.spec.ts`). The marketing layout embeds the toolbar with its React component
(`@uier/toolbar/react`, see `ToolbarScript`).
