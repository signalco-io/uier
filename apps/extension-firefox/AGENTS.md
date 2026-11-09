# apps/extension-firefox

Read [the shared extension guide](../../docs/browser-extension.md) and
[the runtime rules](../../packages/extension/AGENTS.md) before changes.

This is a thin Firefox build target. All runtime, UI, protocol, manifest generation and packaging
logic belongs in the local `@uier/extension-core` package, not this folder. Store API/metadata adapters
belong here; shared artifact identity, source archives and journals stay in the core package. Read
../../docs/browser-extension-firefox-safari-release.md before publishing changes. Keep its version aligned
with the other browser packages. The stable Gecko ID is `uier@signalco.io`; Firefox 153 or later is
required for browser document IDs. Production builds are unsigned resources until Mozilla signs
the package. Local acceptance does not satisfy hosted verification or publication gates.

Build the workspace first, then run this package's validate and package commands. Never publish
`dist-test` or `dist-hosted-test`. Read this folder's README for loading and registration.
