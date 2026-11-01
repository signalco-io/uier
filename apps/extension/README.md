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
- `pnpm -C apps/extension test:browser`: actual packaged Chromium acceptance.

Production client registration and hosted BotID renewal are release gates. No store link exists yet.
