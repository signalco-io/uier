# Shared browser extension

`@uier/extension-core` is the local source package for the Chrome/Edge and Firefox extensions.
There is one popup, content runtime, worker, verification helper and closed messaging protocol.
The toolbar and brand remain separate local packages, reused by the website and every extension.

| Location | Responsibility |
| --- | --- |
| `src/worker.ts`, `src/content.ts`, `src/protocol.ts` | Credential owner, document-bound activation, API broker, toolbar mounting and capture |
| `src/popup.tsx`, `src/helper.ts`, `src/popup.css` | Shared popup and verification UI |
| `src/update.ts` | Store update check against uier's version, and the popup's restart ([Updates](../../docs/browser-extension.md#updates)) |
| `src/browser.ts`, `src/auth.ts`, `src/storage.ts` | Native Promise namespace, browser sign-in and private credential storage |
| `scripts/manifest.mjs` | Permissions, background entry and Firefox registration/consent |
| `scripts/build.mjs`, `validate.mjs`, `package.mjs` | Bundling, brand assets, production audit and deterministic ZIP receipts |
| [Chrome/Edge app](../../apps/extension) | Chrome version, test fixtures, native Chromium acceptance and protected store publishing |
| [Firefox app](../../apps/extension-firefox) | Firefox target/version and package commands |

Run `pnpm build` from the repository root to build the toolbar and both extension targets.
Each browser app supplies its own package version; the core package is private and never published.
Edit shared source here, then rebuild the browser outputs. Generated bundles are not source copies to maintain.

Chrome and Firefox use native identity authorization with state and S256 PKCE.
Firefox refresh credentials live in background-origin IndexedDB, outside content-script
storage. Chromium retains restricted local storage for installed-session compatibility. Access,
proofs, bindings and drafts use private session storage in every browser.

See [the browser guide](../../docs/browser-extension.md) for client registration, trust boundaries,
local loading and the separate hosted/store acceptance gates. Adapter tests run with
`pnpm -C packages/extension test`; actual production bundles run through the Chrome app's
`test:package` suite. Firefox requires native acceptance before distribution.

`scripts/release.mjs` owns package/source identity checks and durable GitHub journals for Firefox
publishing. The Mozilla API client stays in the Firefox app. See [release automation](../../docs/browser-extension-firefox-release.md).
