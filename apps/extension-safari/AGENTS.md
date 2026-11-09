# apps/extension-safari

Read [the shared extension guide](../../docs/browser-extension.md) and
[the runtime rules](../../packages/extension/AGENTS.md) before changes.

This is a thin desktop Safari build target. All runtime, UI, protocol, manifest generation and ZIP
packaging logic belongs in the local `@uier/extension-core` package, not this folder. Native Xcode,
signing and App Store adapters belong here; shared release identity/journals stay in the core package.
Read ../../docs/browser-extension-firefox-safari-release.md before publishing changes. Keep versions
aligned with the other browser packages. The logical authentication client is
`io.uier.safari.Extension`, separate from Safari's runtime ID. Sign-in uses the exact first-party
callback through an extension-owned tab; no native credential bridge is needed.

The generated `xcode/` projects reference the built resources and are ignored. Do not duplicate
runtime files in a native project or commit signing identities. Full Xcode is required to generate,
build and sign the containing macOS app. Native hosted acceptance and App Store submission are
separate from resource validation. Do not claim iOS support from this desktop target.

Build the workspace first, then validate and package. Never distribute `dist-test` or
`dist-hosted-test`. Read this folder's README for project generation and signing.
