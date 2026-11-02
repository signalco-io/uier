# Browser extension

The desktop Manifest V3 extension is an **unreleased implementation** for [#268](https://github.com/signalco-io/uier/issues/268).
It is an additional installation path for signed-in project members. It is not available in a store.
Do not enable production distribution until the hosted verification gate below has passed.

## Design record

The extension bundles the shared toolbar source and its constructed stylesheet. It runs in an
isolated content-script world with explicit configuration; it never loads toolbar.js or a remote
review runtime. Page CSP cannot control worker API transport. The toolbar uses the system font.

Only activeTab, scripting, storage and identity are requested. The sole persistent host permission
is the uier API. No cookies, history, all-sites grant, header rewriting or offscreen permission.
A temporary activeTab grant follows same-origin navigation. Bindings in trusted storage.session
are checked against the current top-frame document and actual tab URL for every operation.
Cross-origin navigation clears activation; returning to the original site requires Start review.

An explicit identity.launchWebAuthFlow opens first-party sign-in and consent. Registered clients
have an exact https://<extension-id>.chromiumapp.org/uier callback. State and S256 PKCE bind a
60-second one-use handoff. It creates a separate eight-hour, server-revocable extension session.
There is no refresh token. Browser restart clears credentials and requires sign-in again.
Project/site tokens last five minutes, renew through the worker, and recheck membership and the
exact configured origin. Every request also rechecks the live session, membership and addresses.
Embed cookies, OAuth/MCP credentials and embed CORS are unchanged.

Verified writes reuse the review services and their five-minute origin/project/reviewer proof.
The worker opens a packaged helper window containing the uier-origin /extension-verification
frame. The parent is an extension document, independent of the reviewed site's frame-src.
Only the registered extension origin can frame that document. The bridge validates source,
origin and nonce; authentication uses a scoped header, with cookies omitted. BotID runs on uier
and the server issues the usual proof only after assertNotBot. Closing or timing out the helper
fails closed. A helper can appear again when proof renewal is needed; this is an intentional
spike limitation to validate before designing a quieter production experience.

The broker exposes a closed review route/method contract, not arbitrary fetch. Private image bytes
also travel through it without signed-URL redirects. Priority writes use the allowlisted PATCH
operation and the same membership, visibility and proof checks as the embedded toolbar. Credentials remain in trusted worker storage;
content scripts receive project configuration, review responses and draft records only. No bearer
is written into the reviewed page, its storage or page-visible messages.

Screenshots use visible-tab capture, with the toolbar hidden for two animation frames. The worker
checks the active tab and document before and after capture, crops in extension-owned canvas, and
encodes under existing image limits. Only the current viewport is captured. Capture errors preserve
text feedback. Saved images are drawn onto canvas from bytes in the isolated world so page img-src
need not permit data or blob URLs. Draft text/anchors use extension session storage, scoped by API,
project, reviewer and page, with the shared seven-day expiry; images are never draft records. Sign-out
clears credentials, private drafts and activation. Drafts currently survive reloads, not browser restart.

A public, secret-free DOM event protocol coordinates embed/extension ownership. A live embedded
runtime yields to the extension, including late loading and a different project. A fake DOM id is
never accepted as a toolbar. This protocol is coordination, not an authentication boundary: a hostile
page can hide or interfere with any injected UI, but cannot acquire extension credentials.

## Local loading

1. Run Node 24 and the pinned Corepack pnpm. Run pnpm install, then pnpm build.
2. For local API acceptance run pnpm -C apps/extension build:test. This separate artifact has a
   fixed development public key and only http://127.0.0.1:4004/* host access by default. Set the
   same `PORT` for `build:test` and `test:browser` to isolate concurrent local runs. Never upload it.
3. Load apps/extension/dist-test unpacked through chrome://extensions (Developer mode).
4. Configure UIER_EXTENSION_CLIENT_IDS with that development ID on the local API. Production
   defaults to disabled: only explicitly configured 32-letter Chrome extension IDs are accepted.
5. Sign in from the popup. Open a configured HTTP(S) site, then Start review. Exit review stops
   continuation. Each reviewer needs the extension for a site without an embed.

Internal browser pages, extension stores, file URLs and cross-origin iframe contents are unsupported.
Authenticated and localhost pages are reviewed in the existing browser session, without copying cookies.

For the hosted spike, run `pnpm -C apps/extension build:hosted-test`. Load the separate
`apps/extension/dist-hosted-test` directory unpacked. It uses the same development public key
with the production API host. An owner must explicitly register that development ID in the hosted
allowlist for the acceptance window, then remove it. Never upload either keyed test package to
the store. `validate` and `package` accept only the unkeyed production output.

## Hosted gate and remaining delivery

Local tests use the existing local BotID mode and **are not hosted evidence**.
Before shipping, record real Chrome and Edge receipts for sign-in, strict-CSP no-embed posting,
reload, replies, resolve/reopen, proof expiry/renewal and screenshot retrieval with third-party cookies
blocked. Verify worker suspension, cross-origin redirects, removed access/addresses, comments off,
private feedback, keyboard use and light/dark accessibility. Resolve helper reliability before rollout.

The app now offers script and extension setup, including onboarding and review-link guidance.
The extension tab explains its pending availability without a fake store link. The released script
remains the default. A store link appears only when `UIER_EXTENSION_AVAILABLE=1`, the valid
`UIER_EXTENSION_STORE_ID` also occurs in `UIER_EXTENSION_CLIENT_IDS`, and owners have completed
the hosted and publication gates. Feedback activity is labelled as feedback, never embed-installation proof.

Native Edge Add-ons, Firefox, Safari, mobile and anonymous extension access remain separate follow-ups.
Extension API contract v1 must remain compatible for one year after its last supported release.
A bad store release requires a higher numeric version containing a fix; installed versions cannot
be rolled back by decreasing the version.

## Validation and delivery

PR CI validates production resources, packages a deterministic ZIP/checksum/source receipt and runs
that unchanged ZIP in persistent Chromium. The local TLS fixture maps the production API hostname to
a disposable loopback proxy, including native identity windows; it never patches the manifest or
bundle and does not contact the production API. The temporary certificate is trusted only by that
browser process's SPKI flag. This verifies the production artifact with local BotID mode, **not real
hosted verification**.

Local acceptance covers real sign-in/consent, multiple project matches, worker transport, strict-CSP
posting/reload, viewport screenshot retrieval/canvas preview, proof renewal, replies, resolve/reopen,
repeated activation, worker shutdown/restart, draft recovery, committed-but-lost write retries,
same-document project switching, Exit/restart, SPA history, cross-origin deactivation, sign-out,
embed coexistence with a different project, text/area anchors, screenshot redaction, safe inactive-tab
capture failure, omitted API cookies and light/dark popup accessibility.
The closed typed worker envelope and shared route contract reject arbitrary URLs/operations,
credential/header injection and malformed payloads. API tests retain current membership, origin,
privacy, comments-off, handoff/PKCE and idempotency coverage. App setup has desktop/mobile keyboard
and light/dark accessibility coverage. Release tests cover tag/main/version checks, reproducible
ZIP bytes, conflicts, bounded async polling, unknown/rejected states and uncertain-write recovery.

The [release runbook](browser-extension-release.md) documents the implemented protected tag/dry-run
and bounded status workflows, Google OIDC/service-account configuration, API v2 receipts, version
support and forward-fix recovery. The [listing worksheet](browser-extension-listing.md) supplies copy,
permission/disclosure drafts and reproducible brand artwork. None enables public rollout.

Remaining gates need owner-controlled external setup and real browser/store evidence:

- Publisher ownership/registration, first manual item upload, stable IDs/callback, reviewer account,
  listing/disclosures and live URL.
- GitHub environment/tag protection, restricted Google federation/service-account publisher access,
  configured identifiers and actual API bootstrap validation (including async upload version limits).
- Hosted Chrome and Edge with real BotID/proof renewal, authenticated/staging pages, blocked cookies,
  tab-switch capture failure, text/area/image editing, keyboard/accessibility and the complete issue matrix.
- One real automatic store update, review/status tracking and installed browser upgrade; then enable
  the verified live installation link. Local tests cannot replace these receipts.

Do not close #268 until its hosted, store and release-automation completion criteria are evidenced.
