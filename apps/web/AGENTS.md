# apps/web - agent guide

The uier.io website and comments API. Next.js 16 App Router, React 19 (React Compiler on),
Tailwind CSS v4 with the signalco minimal theme preset, deployed to Vercel. Runs on
http://localhost:4004 with `pnpm dev` from the repository root.

This guide holds the code map and the rules for every change in `apps/web`. What each feature
does, and the rules that apply only to it, live in [`docs/`](docs/README.md), one note per area.

- Read the note for the area you change. The [index](docs/README.md) lists them, or search with
  `grep -ril <term> apps/web/docs`. Don't read every note.
- When a change alters an area's behaviour or rules, update its note in the same pull request.
  A new area gets a new note and a line in the index.
- Add to this guide only what applies to every change in the package. Feature notes here make
  every session read more and make parallel pull requests conflict.

## Layout

| Path | What |
| --- | --- |
| `app/layout.tsx` | root layout: Geist via `next/font` (`geist` package), metadata and viewport from `@uier/brand`; app and marketing layouts own providers |
| `app/global.css` | Tailwind + UI kit theme + **`@uier/brand/tokens.css`** + shadcn's state variants (`src/styles/shadcn.css`) + `@theme` font and sidebar colour mapping |
| `app/(rest)/(marketing)/` | public pages: `page.tsx` (landing), `brand/page.tsx` (living brand page), `legal/*` (legal documents), `security/page.tsx`, `open-source/page.tsx`, `status/page.tsx`, `features/<feature>/` (one shipped workflow per page, each with its own social card: `ai`, `feedback-triage`, `fix-verification`), `browser-extension/` (the published desktop extension; its setup guide is `guides/browser-extension/`), `layout.tsx` (nav with the section links and Sign in to `/app`, container, footer, clearance for the toolbar) |
| `app/(rest)/(app)/app/` | the app (`/app`): `(auth)/` sign-in, invitation, first-run (`welcome/`) and browser extension sign-in pages (one card), `(shell)/` signed-in pages in the sidebar layout (projects, a project's comments, its settings and install guide, My work, the workspace area `workspace/` with users, teams, clients and settings, account), `connect/` a coding tool's OAuth consent and its public error page (one centred card), `review/[projectId]` review links |
| `src/lib/app/` | app logic: `store.ts` (Cosmos `app` container / in-memory), `model.ts` (documents), `session.ts`, `signIn.ts`, `google/` and `microsoft/` (OIDC sign-in), `passkeys.ts` (passkey sign-in), `avatars.ts` (profile pictures; `avatarLimits.ts` is safe for the browser), `context.ts` (user, workspace, role), `projects.ts`, `projectDeletion.ts` (deleting a project and its records), `projectTransfer.ts` (moving a project to another workspace), `projectRecords.ts` (the grants, services and workspace records both remove), `invitations.ts` (invitations, removing members), `integration.ts` (embed snippets, CSP sources), `siteIcons.ts` (a project site's icon for `ProjectMark`, found and fetched by the server) |
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
| `app/api/mcp/`, `src/lib/mcp/` | the MCP connector: authentication (`credentials.ts`), tools (`server.ts`), prompts, event webhooks (`events/`), client setup blocks ([MCP connector](docs/mcp-connector.md)) |
| `instrumentation.ts` | runs once per Node.js server: registers Next.js `after()` for library code (MCP event delivery after a change), so `src/lib` never imports `next/server` |
| `app/api/oauth/`, `src/lib/mcp/oauth/` | uier's OAuth authorization server for `/api/mcp` only: authorize, token, register, revoke and the metadata routes that `next.config.ts` rewrites from `/.well-known/`; consent is `/app/connect/<requestId>` |
| `app/api/status/route.ts`, `src/lib/status/` | live service checks for `/status` and monitors ([status reference](../../docs/operations.md#status)) |
| `app/api/visitor/route.ts` | the anonymous visitor: guest name (`GET`) and sign out (`DELETE`) |
| `app/api/rewrite/route.ts`, `src/lib/rewrite/` | AI rewrite suggestions for selected text (Anthropic SDK; `503` without `ANTHROPIC_API_KEY`; the e2e tests use `e2e/support/anthropicStub.ts`) |
| `app/manifest.ts`, `app/opengraph-image.tsx` | web manifest and the brand social card, generated from brand constants |
| `src/lib/social/`, `app/og/[card]/route.ts` | social cards: `pageCardImage` for a public page's `opengraph-image.tsx`, and the static cards of app links ([social cards](docs/social-cards.md)) |
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
  Slack and Azure DevOps keep their own colours, as each provider's guidelines ask). AI agent logos (`AgentMark`, `AgentAvatar`,
  `agentMarks` in `@uier/toolbar/agents`) draw in the text colour too, with no hex.
- Radius: `rounded-sm` 6, `rounded-md` 8, `rounded-lg` 10, `rounded-xl` 12, `rounded-2xl` 16,
  `rounded-3xl` 24, `rounded-full`. Borders over shadows; only floating surfaces get the shadow
  from `BRAND.md`.
- Fonts: `font-sans` is Geist, `font-mono` is Geist Mono (variables set on `<html>`). Weights
  400/500/600 only.
- Logo: `<Logo />` from `@uier/brand/Logo` (nav, footer), `<Mark />`, `<Pin />`. The pin is the
  only filled icon; everything else is a 1.75-stroke outline.
- `@uier/brand` is TypeScript source; it is in `transpilePackages` in `next.config.ts` and in a
  `@source` line in `global.css` so Tailwind sees its class names.

## App rules

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
  (`toast()`), mounted with the tooltip provider in the app layout. A change that shows in place (a
  thread's assignee, agent or priority) gets no success toast, only an error toast when it fails;
  confirm with a toast only what nothing on screen shows (a copied link, a deleted comment).
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
- `app/global.css` defines `--radius-sm/md/lg` (the preset's radii are JS values with no variables);
  shadcn's small buttons read `var(--radius-md)`.
- Every server action parses its arguments with zod and checks the session and role itself
  (`appContextOrThrow({ admin })`); pages use `requireAppContext()` / `requireAdminContext()`.
  Positional argument schemas live next to the actions, outside `'use server'` modules; use
  `parseActionInput` for short `UserFacingError` messages before any argument is used. Share
  `app/validation.ts`'s user id schema across mentions and assignment boundaries. Services that
  persist boolean settings validate them again. Never trust ids without loading the document
  from the current workspace.
- Forms use `useActionState` with `actionResult()` (expected failures become `{ ok: false, error }`)
  and controlled inputs, so React's reset after an action never drops what was typed.
- Links the app sends or redirects to come from `appBaseUrl()` (requests) or its shared pure
  `configuredAppBaseUrl()` helper (scheduled workers), never from an untrusted Host header.

## Testing

CSP console audits must be asserted before an axe scan. Axe fetches external stylesheets with
`fetch`, which can produce scanner-only `connect-src` violations on a strict reviewed site.
Start a fresh audit for subsequent product actions; retain the strict policy and assertions.

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
- The feature coverage the area notes describe is the full suite; only tagged browser
  essentials run in the required check. API coverage always runs.
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
