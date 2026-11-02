# Browser extension

The desktop Manifest V3 extension is an **unreleased runtime spike** for [#268](https://github.com/signalco-io/uier/issues/268).
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

The publisher account, initial manual store upload, stable production ID/callback, listing assets,
privacy disclosures, isolated reviewer account, Google OIDC federation and live store link require
owner setup. Do not invent a store URL or advertise availability. Public onboarding stays on the
released script path until this gate is satisfied. Follow #268's owner and store checklists.

Native Edge Add-ons, Firefox, Safari, mobile and anonymous extension access remain separate follow-ups.
Extension API contract v1 must remain compatible for one year after its last supported release.
A bad store release requires a higher numeric version containing a fix; installed versions cannot
be rolled back by decreasing the version.

## Validation and publishing work still required

The PR job validates the production manifest/resources, creates a versioned ZIP/checksum/source
receipt, and runs the separate localhost package in persistent Chromium. Local acceptance covers
real identity consent, worker transport, the helper, posting/reload, screenshot capture and canvas
preview under strict CSP, proof-cache renewal, replies, resolve/reopen, cross-origin deactivation,
worker-owned sign-out cleanup, early/late embed coexistence and popup light/dark accessibility. API tests cover one-use/expiry,
callback/client/PKCE rejection, exact-origin binding, membership revocation, comments off and CORS.
This is not production-package or hosted Chrome/Edge acceptance.

Remaining implementation after the hosted gate:

- Complete the browser matrix: different embedded projects, worker suspension,
  authenticated/staging sites, SPA/history and redirects, blocked storage/cookies, multiple matches,
  private feedback, safe retries, draft recovery, image replacement/redaction and keyboard journeys.
- Finish project Installation/onboarding/empty-state/review-link choices with a verified store URL.
- Implement protected extension-vX.Y.Z release and bounded status workflows, environment/ref trust,
  Google OIDC/service-account federation, Chrome Web Store API v2 upload/publish/fetchStatus,
  dry-run, receipts and conflict-safe resumption. This spike has no store upload/publish workflow.
- Configure the publisher/account/initial listing and isolated reviewer project. Validate the real
  API credentials during bootstrap, exercise one update and store review, then document dashboard
  cancellation, credential revocation and forward-fix recovery using the resulting live identifiers.

Do not close #268 until its hosted, store and release-automation completion criteria are evidenced.
