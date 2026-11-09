# Rebuilding extension submissions

Mozilla receives an archive of the exact Git commit used by the release workflow: original
TypeScript, styles, local packages, exact dependency lockfile and these instructions. It excludes
untracked and ignored files, credentials, generated resources and dependencies. The package and
source archive have SHA-256 receipts identifying the same commit.

Use Node 26 and the Corepack pnpm version from `package.json`:

```sh
npm install --global corepack@latest
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @uier/extension-firefox... build
pnpm -C apps/extension-firefox validate
pnpm -C apps/extension-firefox lint:store
```

Unsigned resources are in `apps/extension-firefox/dist`. Compare these with the submission ZIP
before Mozilla adds its signature. ZIP timestamps can depend on the source checkout; compare
the contained resource bytes. Building needs no production database, API credentials, environment
file or signing credential. The API endpoint is `https://uier.io`.

The browser app selects a target. `packages/extension` owns the worker, content script, popup,
verification helper and build tooling; `packages/toolbar` owns the review layer, and `packages/brand`
owns assets and tokens. The toolbar stylesheet builds first and is inlined by the shared builder.
All executable resources are bundled; the package does not download a remote runtime.

Run adapter/release tests with `pnpm -C packages/extension test` and
`pnpm -C apps/extension-firefox test`. Chrome's production-ZIP acceptance is a separate local
integration test; it does not establish Firefox hosted acceptance. See
[release automation](browser-extension-firefox-release.md).
