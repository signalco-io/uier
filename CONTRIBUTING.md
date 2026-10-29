# Contributing to uier

Bug reports, ideas and pull requests are welcome. [uier.io/open-source](https://uier.io/open-source)
explains the project and its licenses.

## Questions, bugs and ideas

Open an [issue](https://github.com/signalco-io/uier/issues). Include what you expected, what happened,
and steps to reproduce it. For a security problem, follow [SECURITY.md](SECURITY.md).

## Setting up

Start with the [README quick start](README.md#run-locally). You need Node.js 24 and pnpm through
Corepack. No database or email credentials are needed for local development.

[Local development and testing](docs/development.md) covers environment variables, ports, browser
installation and test coverage. [Infrastructure and operations](docs/operations.md) covers the
separate infrastructure setup, credentials and CI/CD.

## Code conventions

- **Brand.** Read [`packages/brand/BRAND.md`](packages/brand/BRAND.md) before changing anything a user
  sees. Use colours and radii from `@uier/brand/tokens.css` through semantic classes such as
  `text-muted-foreground`, `border-border` and `rounded-xl`. Use the existing `<Logo />`, `<Mark />`
  and `<Pin />` components. Keep copy in sentence case, use short sentences and no exclamation marks,
  and make only claims the product can back. The name is always **uier**, lowercase.
- **UI kit.** Public pages use `@signalco/ui` and `@signalco/ui-primitives`. The signed-in app uses
  the shadcn/ui components in `apps/web/src/components/ui`. Do not build parallel buttons, inputs
  or menus. See [the web guide](apps/web/AGENTS.md#styling-rules) for styling and component details.
- **Dependencies.** Use exact versions and the pinned pnpm version. Renovate keeps dependencies
  current; pnpm and Renovate wait a day after an npm release.
- **Secrets.** Keep credentials out of Git. Local variables belong in `apps/web/.env.local`;
  deployment variables are managed by Pulumi.
- **Infrastructure.** CI applies changes. Do not run `pulumi up` locally or remove resource
  protection. Read [the infrastructure guide](infra/AGENTS.md) before changing infrastructure.

When a brand value changes, update the implementation in `packages/brand` and `BRAND.md` together.
If the mark changed, re-render the icon set with `pnpm -C packages/brand icons`. Check `/brand`
locally; it renders from the same package as the website and toolbar.

Each package's `AGENTS.md` records its implementation rules and code map. They are also useful to
human contributors; [the root guide](AGENTS.md) links to each one.

## Documentation conventions

- Keep the README focused on the product, local quick start, everyday commands and navigation.
- Keep contributor workflow and shared conventions here. Put agent instructions in the matching
  `AGENTS.md`, and detailed behavior, API contracts and runbooks in `docs/` or the package guide.
- Update the guide that describes your change and keep [the documentation index](docs/README.md)
  useful. Check relative paths and section links when moving content.
- Keep the brand guide and [live brand page](https://uier.io/brand) aligned. Changes to privacy,
  retention, cookies or security controls also need the matching public documents updated; see
  [the web guide](apps/web/AGENTS.md#legal-documents).

## Testing while implementing

Run typecheck and the relevant feature's spec files during implementation. Start browser checks
with Desktop Chrome; include Mobile Chrome for touch or responsive behavior. Refresh the production
build after app or toolbar changes before invoking Playwright directly. The
[testing guide](docs/development.md#while-implementing) has file, project and single-test commands.

The short `pnpm test` run belongs before pushing a PR. Full regressions (`pnpm test:full`) are
exceptional: use them for broad verification when focused checks are insufficient or a full run is
explicitly requested. A new feature does not require a full run. For documentation-only changes,
check content and links without running application checks.

## Pull requests

1. Branch from `main` and open the pull request against `main`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and the pull request
   title (`feat:`, `fix:`, `docs:`, `chore(deps):` …).
3. For code, dependency or build/test configuration changes, run
   `pnpm typecheck && pnpm build && pnpm test` before you push. For documentation-only changes,
   check the content and links. Install the Playwright browser
   once with `pnpm -C apps/web exec playwright install --with-deps chromium`. Stop the dev server
   or use `PORT=4104 pnpm test` to avoid a port conflict.
   The required run includes all API tests and essential browser journeys. The full regression
   suite is not a routine PR requirement. Reserve `@smoke` / `@mobile-smoke` tags for critical
   user journeys.
4. Explain the problem, the resulting behavior and how you verified it. Update the relevant docs
   and package guide.
5. Wait for **CI OK** before merging. CI selects web checks, the Vercel preview and the infrastructure
   preview by changed paths. Fork pull requests only run checks that need no secrets.

`main` is production. Pushes trigger deployment unless all changed paths are excluded by the
[deployment workflow](.github/workflows/deploy.yml). Infrastructure runs before the website.
Follow any active deployment or recovery hold in the [operations guides](docs/README.md#operations).

## Repository history

This code was split out of the [signalco-io/signalco](https://github.com/signalco-io/signalco) monorepo
with its git history preserved (`web/apps/uier` → `apps/web`, `web/packages/uier-toolbar` →
`packages/toolbar`, `infra/apps/uier` → `infra`). Issue and pull request references in older commit
messages (`signalco-io/signalco#1234`) point to the original repository.

## License

By contributing you agree that your contribution is licensed under the license of the package you change:
AGPL-3.0-only for `apps/web` and anything without its own license, MIT for `packages/toolbar`,
`packages/brand` and `infra`.
