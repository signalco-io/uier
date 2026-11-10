# uier for Firefox

Desktop Firefox target for the shared [uier extension runtime](../../packages/extension).
The popup, toolbar, sign-in, API broker and build tools come from local workspace packages.
This target requires Firefox 153 or later to preserve document-bound review activation.
Version 0.1.5 was submitted to Mozilla on 10 November 2026 and is awaiting review. Native hosted
acceptance passed; public installation and signed-store checks remain pending. See the
[submission receipt](../../docs/browser-extension-firefox-release.md#submission-receipt--10-november-2026).
The [user setup guide](https://uier.io/guides/browser-extension) explains availability and the shared
sign-in/review steps. The temporary loading steps below are for development, not normal installation.

Use Node 26 and the repository's pinned Corepack pnpm. From the repository root:

- `pnpm build` builds the shared dependencies and all browser targets.
- `pnpm -C apps/extension-firefox validate` checks the production manifest and resources.
- `pnpm -C apps/extension-firefox package` produces a deterministic ZIP, checksum and source receipt in `release/`.
- `pnpm -C apps/extension-firefox build:test` creates `dist-test/` for the local API. Set `PORT` to choose its port.
- `pnpm -C apps/extension-firefox build:hosted-test` creates `dist-hosted-test/` for hosted acceptance.

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the built
`manifest.json`. The manifest declares the stable add-on ID `uier@signalco.io`. Register its exact
`browser.identity.getRedirectURL()` callback using `UIER_EXTENSION_CLIENTS` on the API;
see [the extension guide](../../docs/browser-extension.md) for registration and security details.
A temporary add-on is removed when Firefox restarts. Mozilla signing is required for normal installation.

Before distributing, sign and submit the production ZIP through Mozilla, then record real hosted
sign-in, verification renewal, screenshots, navigation and installed-update acceptance. Chromium
runtime tests and manifest validation do not provide Firefox acceptance. Never submit a local or
hosted test artifact.

CI lints with pinned `web-ext` and retains the deterministic ZIP. The protected release workflow
can submit this ZIP and the exact committed source to Mozilla for signing/review. It uses
`extension-firefox-production`, API secrets, native evidence and a separate publishing flag.
Dry runs need no store credentials. See [release setup and recovery](../../docs/browser-extension-firefox-release.md#firefox-setup).
