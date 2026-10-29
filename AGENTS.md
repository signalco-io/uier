# AGENTS.md

Guidance for AI coding agents (and new humans) working in this repository. Each package has
its own `AGENTS.md` with the details that matter there; read the one for the folder you touch.

## What this is

uier ([uier.io](https://uier.io)) lets people review a live website by leaving comments
directly on the page. A toolbar is injected into the reviewed page (its own shadow root),
comments are pinned to elements or selected text and stored per domain.

| Path | Package | What | Guide |
| --- | --- | --- | --- |
| `apps/web` | `@uier/web` | uier.io website, `/brand` page, the signed-in app (`/app`) and the `/api/comments` API (Next.js, Cosmos DB) | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| `packages/toolbar` | `@uier/toolbar` | the review toolbar bundle (tsup, React, shadow DOM) | [packages/toolbar/AGENTS.md](packages/toolbar/AGENTS.md) |
| `packages/brand` | `@uier/brand` | **the brand: tokens, logo, constants, assets, `BRAND.md`** | [packages/brand/AGENTS.md](packages/brand/AGENTS.md) |
| `infra` | `@uier/infra` | Pulumi (Vercel project, Cloudflare DNS, Cosmos DB); not in the pnpm workspace | [infra/AGENTS.md](infra/AGENTS.md) |

The [README](README.md) is the human entry point: product overview, quick start, commands and
links. Keep contribution rules in [CONTRIBUTING.md](CONTRIBUTING.md), package-specific agent
instructions in the matching `AGENTS.md`, and detailed references and runbooks in [docs/](docs/README.md).
When moving documentation, update relative links and links to section anchors across the repository.

## Ground rules

- **Brand decisions are already made.** Read [`packages/brand/BRAND.md`](packages/brand/BRAND.md)
  before touching anything a user sees. Colours and radii come from `@uier/brand/tokens.css`
  through the UI kit's semantic classes (`text-muted-foreground`, `border-border`,
  `rounded-xl`); the logo is `<Logo />` / `<Mark />` / `<Pin />` from `@uier/brand`. Never
  hardcode a hex, redraw the mark, or write "Uier".
- **Use the UI kit.** Public pages use `@signalco/ui` and `@signalco/ui-primitives` (npm). The signed-in
  app (`/app`) uses the [shadcn/ui](https://ui.shadcn.com) components in `apps/web/src/components/ui`
  (add more with `pnpm dlx shadcn@latest add <name>` in `apps/web`; the project skill is
  `.claude/skills/shadcn`). Do not build parallel buttons, inputs or menus.
- **Keep copy in the brand voice:** sentence case, short sentences, no exclamation marks, only
  claims the product can back.
- **Node 24, pnpm via Corepack** (`corepack enable`), exact dependency versions (Renovate keeps
  them current; it waits a day after an npm release, and so does `pnpm install`).
- **Conventional Commits** (`feat:`, `fix:`, `chore(deps):` ...) and pull requests against
  `main`. `main` is production: pushes deploy (`pulumi up`, then Vercel) unless all changed
  paths are excluded by `.github/workflows/deploy.yml`.
- Do not run `pulumi up` locally and do not change protected infrastructure; CI applies infra.
- Secrets never go in the repo. `COSMOSDB_CONNECTION_STRING` and `UIER_COMMENTS_SECRET` live in
  Vercel (set by Pulumi); a local connection string goes in `apps/web/.env.local`.

## Commands (repository root)

| Command | What |
| --- | --- |
| `pnpm install` | install the workspace (`apps/*`, `packages/*`) |
| `pnpm dev` | website on http://localhost:4004 and the toolbar watch build on http://localhost:4005 |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm build` | production build of the website and the toolbar |
| `pnpm test` | All API tests and essential browser journeys against the built app (install the browser once: `pnpm -C apps/web exec playwright install --with-deps chromium`) |
| `pnpm test:full` | Full Playwright regression suite, including every desktop/mobile browser spec |
| `pnpm -C packages/brand icons` | re-render the PNG icon set from the mark |

CI selects typecheck, build, e2e and a Vercel preview for app/workspace changes, and a
`pulumi preview` for infrastructure changes. Fork PRs only run checks that need no secrets.
The single required check is **CI OK**.

Keep the default browser suite small: tag only critical journeys with `@smoke` (desktop) and
`@mobile-smoke` (mobile). Feature permutations belong in `pnpm test:full`; authorization and
validation belong in the API suite, which always runs. See [testing](docs/development.md#commands).

## Before you open a pull request

1. `pnpm typecheck && pnpm build && pnpm test` pass locally.
2. Anything user-facing matches `BRAND.md`; if you changed a brand value, `BRAND.md` and
   [uier.io/brand](https://uier.io/brand) (`/brand` locally) say the same thing.
3. Docs that describe what you changed are updated (the relevant guide in `docs/`, package
   documentation and `AGENTS.md`; README when setup, commands or navigation change).
