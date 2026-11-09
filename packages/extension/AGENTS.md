# packages/extension

Read ../../docs/browser-extension.md and ./README.md before changes. This local package owns the
runtime and build/manifest/validation/ZIP logic shared by all browser apps. Browser apps only select
a target and version; do not copy runtime code into their folders.
Do not claim hosted BotID acceptance from local-mode tests or enable public rollout before the
hosted, store, automatic-upgrade and post-update gates are recorded. Native Chrome and Edge
automatically upgraded the published store package from 0.1.1 to 0.1.2 and passed post-update
acceptance. Protected release writes are enabled; the optional status schedule remains disabled.
Read ../../docs/browser-extension-release.md before touching publishing.

Build bundles shared toolbar source through @uier/toolbar/extension. Configure adapters before
loading runtime; never inject a remote script or use page globals for credentials. Main-world code
is forbidden. The only cross-world protocol is secret-free toolbar coexistence.

worker.ts is the sole credential owner. Chromium storage.session and local access stay TRUSTED_CONTEXTS.
Firefox/Safari session storage stays private by default; persistent refresh credentials use extension-origin
IndexedDB because their storage.local cannot be restricted to trusted contexts. Never fall back to local.
Only the API-scoped refresh credential/local identity/pending attempt persist across browser restarts.
Access lasts 15 minutes; refresh rotates with 30-day inactivity and one-year absolute limits.
Persist the attempt before refresh; exact retries recover the same successor. Keep refresh writes
single-flight and fenced against sign-out. Bindings, proofs and drafts remain session-only.
Validate sender extension ID, top frame, browser document ID, current tab URL and the active binding
for every content operation. Keep the shared extension-contract allowlist closed. No arbitrary URL,
method, headers or bearer from a content message. API credentials and verification proofs never
reach content scripts. Drafts contain only bounded shared text/anchor records, no images.

Permissions are activeTab, scripting, storage, plus the API host; Chrome/Firefox also use identity. No all-sites grant, cookies,
security-header rewriting or offscreen permission. Screenshots check the active tab before and
after capture, leave the UI hidden until done, crop to viewport and preserve text on failure.

Use shared brand assets/tokens and UI-kit controls. Runtime version comes from package.json.
Popup/helper classes compile from src/popup.css (toolbar Tailwind setup, packaged Geist); primary
actions are solid ink. Icons render from MARK_PATH in build.mjs; store art in store-assets.mjs.
Run root typecheck/build/short tests before a PR, plus validate/package and the persistent Chromium
suite after runtime changes. Test dist output, not source or a mocked extension API.

protocol.ts defines the closed worker envelope; route authorization remains in the shared contract.
Never remove pre-write store receipts or retry ambiguous writes. Test the unchanged production ZIP
with test:package; its loopback TLS fixture is local acceptance, never hosted BotID evidence.
Dispose the content runtime synchronously on pagehide, including BFCache navigation. Only the
worker may remount a restored document after checking its live binding; stale lazy mounts must stop.

Browser differences belong in browser.ts, auth.ts, storage.ts and scripts/manifest.mjs. Preserve
native document IDs and top-frame targeting; do not downgrade sender checks for compatibility.
Safari uses a fixed logical client ID, but sender checks always use the native runtime ID.
