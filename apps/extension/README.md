# uier browser extension

Manifest V3 extension for desktop Chrome and Edge. Version 0.1.2 is published in the Chrome Web Store.
Both native browsers automatically upgraded from 0.1.1 and passed post-update acceptance.
The release runbook records the app installation-link rollout.
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

The [official Chrome Web Store item](https://chromewebstore.google.com/detail/uier/kplfcfnpeljpkbcjgpaefpmggipfpemj)
is public. Production client registration and hosted BotID renewal are recorded in the release
receipts, together with the actual automatic upgrade and native acceptance. Version 0.1.3 is
prepared for the next protected release; it drops the popup's development-preview label.

The [release runbook](../../docs/browser-extension-release.md) covers the implemented tag/dry-run
and bounded status workflows, owner bootstrap and recovery. [Listing drafts](../../docs/browser-extension-listing.md)
include copy, disclosures and reviewer requirements. No Google or store credentials are needed by PR CI.
