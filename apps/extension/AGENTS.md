# apps/extension

Read ../../docs/browser-extension.md before changes. This is an unreleased runtime spike, not a
published extension. Do not claim hosted BotID acceptance from local-mode tests or enable rollout
before the gate is recorded. Store bootstrap and release automation remain separate delivery work.

Build bundles shared toolbar source through @uier/toolbar/extension. Configure adapters before
loading runtime; never inject a remote script or use page globals for credentials. Main-world code
is forbidden. The only cross-world protocol is secret-free toolbar coexistence.

worker.ts is the sole credential owner. storage.session and local access stay TRUSTED_CONTEXTS.
Validate sender extension ID, top frame, browser document ID, current tab URL and the active binding
for every content operation. Keep the shared extension-contract allowlist closed. No arbitrary URL,
method, headers or bearer from a content message. API credentials and verification proofs never
reach content scripts. Drafts contain only bounded shared text/anchor records, no images.

Permissions are activeTab, scripting, storage, identity plus the API host. No all-sites grant, cookies,
security-header rewriting or offscreen permission. Screenshots check the active tab before and
after capture, leave the UI hidden until done, crop to viewport and preserve text on failure.

Use shared brand assets/tokens and UI-kit controls. Runtime version comes from package.json.
Run root typecheck/build/short tests before a PR, plus validate/package and the persistent Chromium
suite after runtime changes. Test dist output, not source or a mocked extension API.
