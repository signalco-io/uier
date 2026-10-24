# Contributing to uier

Bug reports, ideas and pull requests are welcome. [uier.io/open-source](https://uier.io/open-source)
explains the project and its licenses.

## Questions, bugs and ideas

Open an [issue](https://github.com/signalco-io/uier/issues). For a security problem, do not open an issue:
follow [SECURITY.md](SECURITY.md).

## Setting up

You need Node.js 24 (see [`.nvmrc`](.nvmrc)) and pnpm through Corepack:

```bash
corepack enable
pnpm install
pnpm dev
```

The website runs on http://localhost:4004 and the toolbar build on http://localhost:4005. No database is
needed: without `COSMOSDB_CONNECTION_STRING` the comments API keeps comments in memory. The
[README](README.md) covers every command, the comments API, the infrastructure and CI/CD.

Each package has an `AGENTS.md` with the rules that matter there; start at [AGENTS.md](AGENTS.md). They are
written for AI coding agents and work just as well for people.

## Making a change

- **Brand.** Anything a user sees follows [`packages/brand/BRAND.md`](packages/brand/BRAND.md): colours and
  radii from the brand tokens, the logo from `@uier/brand`, copy in sentence case with short sentences, no
  exclamation marks and only claims the product can back. The name is always **uier**, lowercase.
- **UI kit.** Components come from `@signalco/ui` and `@signalco/ui-primitives`; do not build parallel
  buttons, inputs or menus.
- **Dependencies.** Exact versions only. Renovate keeps them current.
- **Docs.** Update the README and the package `AGENTS.md` when you change what they describe.

## Pull requests

1. Branch from `main` and open the pull request against `main`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and the pull request title
   (`feat:`, `fix:`, `docs:`, `chore(deps):` ...).
3. Run `pnpm typecheck && pnpm build && pnpm test` before you push. The end-to-end tests need the Playwright
   browser once: `pnpm -C apps/web exec playwright install --with-deps chromium`.
4. CI runs the same checks plus a preview deployment; the **CI OK** check must pass before merging.

`main` is production: every merge deploys to uier.io.

## License

By contributing you agree that your contribution is licensed under the license of the package you change:
AGPL-3.0-only for `apps/web` and anything without its own license, MIT for `packages/toolbar`,
`packages/brand` and `infra`.
