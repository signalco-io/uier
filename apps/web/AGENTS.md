# apps/web - agent guide

The uier.io website and comments API. Next.js 16 App Router, React 19 (React Compiler on),
Tailwind CSS v4 with the signalco minimal theme preset, deployed to Vercel. Runs on
http://localhost:4004 with `pnpm dev` from the repository root.

## Layout

| Path | What |
| --- | --- |
| `app/layout.tsx` | root layout: Geist via `next/font` (`geist` package), metadata and viewport from `@uier/brand`, providers |
| `app/global.css` | Tailwind + UI kit theme + **`@uier/brand/tokens.css`** + `@theme` font mapping |
| `app/(rest)/(marketing)/` | public pages: `page.tsx` (landing), `brand/page.tsx` (living brand page), `legal/*` (legal documents), `layout.tsx` (nav, container, footer, clearance for the toolbar) |
| `app/(rest)/(app)/` | the signed-in app shell (`/app`) |
| `app/api/comments/route.ts` | comments API (Cosmos DB through `src/lib/db` and `src/lib/repo`) |
| `app/manifest.ts`, `app/opengraph-image.tsx` | web manifest and social card, generated from brand constants |
| `src/components/marketing/` | `SiteFooter` (the footer of every public page; `Footer1` vendored from signalco renders it), landing sections (`ReviewThreadDemo`) |
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
review layer is shown on the page itself (`ReviewThreadDemo` and `<Pin />`), one solid
"Get started" and one outlined secondary action, no badges above the headline.
`e2e/landing.spec.ts` asserts the title, the `h1`, the "Get started" link and the footer line
through the brand constants; update the test when you change those on purpose.

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

## Testing

- `pnpm typecheck` (runs `next typegen` first), `pnpm build`, then `pnpm test` (Playwright
  against `next start` on `PORT`, default 4004, e.g. `PORT=4104 pnpm test`; API, Desktop and
  Mobile Chrome). Outside CI a server that already answers on that port is reused, `pnpm dev`
  included, so stop it or pick another `PORT` to test the build.
- Accessibility is part of the suite: new pages should be added to an `assertAccessibility`
  test. Keep text at 4.5:1 or better (`text-muted-foreground` is the lightest text colour).
- Locally the comments API keeps comments in memory; `COSMOSDB_CONNECTION_STRING` in `.env.local`
  points it at a real Cosmos DB. Deployments get their Cosmos DB settings and `UIER_COMMENTS_SECRET`
  from Pulumi: production an account key, previews Entra ID with the Vercel OIDC token
  (`src/lib/db/client.ts`), scoped to the `comments-preview` container.

## Toolbar in development

`app/layout.tsx` loads http://localhost:4005/index.js in development only. Open any page with
`?review=true` (for example `/brand?review=true`) to see the real toolbar on top of it.
