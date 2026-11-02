# uier browser extension

Unreleased Manifest V3 runtime spike for desktop Chrome and Edge. Do not distribute to users yet.
The [design and hosted gate](../../docs/browser-extension.md) records security boundaries, local
loading and remaining publication work. Licensed AGPL-3.0-only; shared toolbar/brand remain MIT.

From the repository root, use Node 24 and the pinned Corepack pnpm:

- `pnpm build`: production API package, with all executable resources bundled.
- `pnpm -C apps/extension build:test`: separate unpacked local test package.
- `pnpm -C apps/extension build:hosted-test`: separately keyed hosted acceptance artifact; requires owner registration.
- `pnpm -C apps/extension validate`: audit production manifest and resources.
- `pnpm -C apps/extension package`: ZIP, SHA-256 and source metadata.
- `pnpm -C apps/extension test`: broker, reproducibility and release-state tests (build first).
- `pnpm -C apps/extension test:package`: unchanged production ZIP in persistent Chromium, local API.
- `pnpm -C apps/extension test:browser`: separately built localhost development package.
- `pnpm -C apps/extension store:assets`: brand store icon and promotional tile.

Production client registration and hosted BotID renewal are release gates. No store link exists yet.

The [release runbook](../../docs/browser-extension-release.md) covers the implemented tag/dry-run
and bounded status workflows, owner bootstrap and recovery. [Listing drafts](../../docs/browser-extension-listing.md)
include copy, disclosures and reviewer requirements. No Google or store credentials are needed by PR CI.
