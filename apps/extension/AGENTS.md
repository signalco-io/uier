# apps/extension

Chrome/Edge packaging and release shell. Read [the shared package guide](../../packages/extension/AGENTS.md)
before runtime or build changes, [the browser guide](../../docs/browser-extension.md) for the design,
and [the release runbook](../../docs/browser-extension-release.md) before publishing changes.

Runtime, UI, manifest generation, build, validation and ZIP packaging live in `@uier/extension-core`
(`packages/extension`). Keep these scripts as thin target selectors. The Chrome package name,
production ZIP name, version and protected publishing/receipt protocol must remain compatible.

This folder owns Chrome release/store scripts, artwork and persistent Chromium acceptance. Run
root typecheck/build/short tests, shared package tests, validate/package and the unchanged production
ZIP suite after runtime changes. Do not infer hosted, Firefox or Safari acceptance from Chromium.
Never remove pre-write store receipts or retry ambiguous store writes.
