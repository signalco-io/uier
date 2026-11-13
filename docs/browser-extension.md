# Browser extension

The desktop Manifest V3 extension is an additional installation path for signed-in project members,
tracked in [#268](https://github.com/signalco-io/uier/issues/268). Chrome and Edge install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/uier/kplfcfnpeljpkbcjgpaefpmggipfpemj).
Both native browsers automatically upgraded from the installed 0.1.1 baseline to 0.1.2 and passed
post-update acceptance. Public visibility and the app's installation link are live;
see [the latest receipt](browser-extension-release.md#automatic-upgrade-receipt--3-november-2026).

The shared Firefox target requires desktop Firefox 153 or later. Version 0.1.5 passed native hosted
acceptance and was submitted to Mozilla on 10 November 2026. It is awaiting review, with public
installation and signed-store checks still pending. See the
[Firefox submission receipt](browser-extension-firefox-release.md#submission-receipt--10-november-2026).

## Design record

The extension bundles the shared toolbar source and its constructed stylesheet. It runs in an
isolated content-script world with explicit configuration; it never loads toolbar.js or a remote
review runtime. Page CSP cannot control worker API transport. The toolbar uses the system font.
The popup and verification helper are extension pages: their stylesheet (`src/popup.css`) is
compiled from the toolbar's Tailwind setup and brand tokens, and Geist ships in the package
(`fonts/`, with its license), so they load nothing remote. They follow the system theme. The popup
shows the active tab's site, the matching projects, an active review with Exit review, and Open uier
and Sign out. The 16/32/48 px icons are the rounded app icon; the 128 px icon keeps 16 px padding.
While a review is on in a tab, that tab's toolbar icon shows the popup's green dot (`icons/active-*.png`,
the brand success colour with a paper ring). The worker sets it after each mount and resets it whenever
the binding ends: Exit review, a different site, sign-out, an update restart or a closed tab.

The toolbar's Accessibility and SEO panels work as on the web. Their audit asset (axe-core and the
on-demand page checks, [page checks](../packages/toolbar/docs/page-checks.md)) is `audit.js`, a
separate file of the package built from the toolbar's `checks/auditEntry.ts` (about 680 KB, 190 KB of
the ZIP), never part of `content.js`. When the toolbar first checks a document (the background audit
once the page is idle, or a panel), the content runtime sends the closed `audit` message. The worker
checks the sender's live binding and document as for every content operation, runs the file with
`scripting.executeScript({ files: ['audit.js'], world: 'ISOLATED' })` in that tab's top frame and
confirms the returned document ID. The asset hands axe-core and the checks to the toolbar through a
symbol on the isolated world's own global object, which page scripts cannot read, and axe-core's own
`axe` global is removed again. It uses the review's activeTab and scripting access: no new
permission, no `web_accessible_resources`, nothing downloaded, and the page's CSP does not apply.
The toolbar's languages but English, which the web loads as assets, are part of `content.js`
([extension adapter](../packages/toolbar/docs/extension-adapter.md#languages)).
axe-core needs no `eval`. The panels draw in the toolbar's shadow root, so strict `img-src` and
`style-src` do not affect them.

Chrome/Firefox request activeTab, scripting, storage and identity. The sole persistent host permission
is the uier API. No cookies, history, all-sites grant, header rewriting or offscreen permission.
A temporary activeTab grant follows same-origin navigation. Bindings in trusted storage.session
are checked against the current top-frame document and actual tab URL for every operation.
Cross-origin navigation clears activation; returning to the original site requires Start review.
Content runtimes remove their host and listeners on `pagehide`, before a document can enter the
back/forward cache. Only worker reinjection with a live binding restores same-origin continuation;
an old cached document cannot revive its toolbar after cross-origin deactivation. Lazy mounting
also checks that the content runtime has not been disposed.

An explicit identity.launchWebAuthFlow opens first-party sign-in and consent in Chrome/Firefox.
Chrome clients have an exact
https://<extension-id>.chromiumapp.org/uier callback; other callbacks are registered explicitly below. State and S256 PKCE bind a
60-second one-use handoff. Updated packages request a renewable, server-revocable extension session:
access tokens last 15 minutes, rotating refresh tokens extend a 30-day inactivity window, and a
session ends after one year regardless of activity. Only the refresh credential and a local identity
are persisted in API-scoped `chrome.storage.local`, restricted to `TRUSTED_CONTEXTS`, on Chrome/Edge,
and in extension-origin IndexedDB on Firefox; access tokens,
active bindings, proofs and drafts stay in `storage.session`. Browser restart keeps sign-in but
requires Start review again. A worker refresh is single-flight and persists a random attempt before
sending it. An exact retry recovers the same successor after a lost response or worker suspension;
reuse with another attempt revokes the session. Server records contain only credential/attempt
hashes. Logout accepts a known refresh credential even after access expiry, revokes the session and
clears both credential stores. Offline/temporary refresh failures retain the pending attempt for retry.
Renewable consent uses `renewable=true` on the authorization request and binds it to the handoff;
the exchange must opt in with `renewable: true`. Legacy packages that omit it retain their eight-hour, session-only sign-in; existing
sessions are not silently upgraded. The updated package needs one sign-in to obtain refresh access.
Project/site tokens last five minutes, renew through the worker, and recheck membership and the
exact configured origin. Every request also rechecks the live session, membership and addresses.
Embed cookies, OAuth/MCP credentials and embed CORS are unchanged. Refresh tokens authenticate only
`POST /api/extension/refresh` (`clientId`, `refreshToken`, `attempt`) and session revocation, never
review/project APIs. Refresh is limited to 120 attempts per session per hour; idle/absolute expiry,
user existence and the client allowlist are checked server-side. Rotated hashes expire with their
original 30-day token window; deleting a session stops its access and scoped tokens immediately.

Verified writes reuse the review services and their five-minute origin/project/reviewer proof.
The worker opens a packaged helper window containing the uier-origin /extension-verification
frame. The parent is an extension document, independent of the reviewed site's frame-src.
The frame keeps the window's full size under a status card, so it runs like any visible frame.
Only the registered extension origin can frame that document. The bridge validates source,
origin and nonce; authentication uses a scoped header, with cookies omitted. BotID runs on uier
and the server issues the usual proof only after assertNotBot. Closing or timing out the helper
fails closed. A helper can appear again when proof renewal is needed; this is an intentional
spike limitation to validate before designing a quieter production experience.

The broker exposes a closed review route/method contract, not arbitrary fetch. Private image bytes
also travel through it without signed-URL redirects. Priority writes use the allowlisted PATCH
operation and the same membership, visibility and proof checks as the embedded toolbar. Comment lists
forward the archive filter through the closed query contract; archive/restore uses the existing
comment PATCH operation, preserving workflow status and the strict-CSP reload path. Credentials remain in trusted worker storage;
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

## Browser targets

All desktop targets use `@uier/extension-core` in [packages/extension](../packages/extension).
It owns the worker, content runtime, popup, helper, styles, manifest generation and packaging.
Browser apps select a target and version; they contain no copies of that code. The existing
`@uier/toolbar` and `@uier/brand` packages remain shared with the website.

| Browser | Build output | Local loading / packaging |
| --- | --- | --- |
| Chrome and Edge | `apps/extension/dist` | Load unpacked; existing Chrome store pipeline and ZIP name |
| Firefox 153+ | `apps/extension-firefox/dist` | Temporary add-on from `about:debugging`; deterministic ZIP for Mozilla signing |

`pnpm build` builds all targets. Each app has `build:test`, `build:hosted-test`, `validate` and
`package` commands. The test modes keep the API environments separate; only Chromium gets its
development public key. See [Firefox setup](../apps/extension-firefox/README.md) for registration, loading and Mozilla signing.

The API keeps Chrome IDs in `UIER_EXTENSION_CLIENT_IDS`. Additional clients must be enabled
explicitly with `UIER_EXTENSION_CLIENTS`, for example:

```json
[
  { "id": "uier@signalco.io", "browser": "firefox", "redirectUri": "https://<value-from-firefox>.extensions.allizom.org/" }
]
```

Replace the Firefox placeholder with the exact URL returned by `browser.identity.getRedirectURL()`
in the extension context. Firefox UUID origins are supplied during authorization and bound to the handoff, live session and scope.
The verification helper uses one validated exact frame ancestor. A successful refresh can rebind
a changed extension UUID; previous access/scope tokens then fail. See [server registration](../apps/web/docs/browser-extension.md).

Chrome uses a module service worker; Firefox uses packaged background scripts, which are
nonpersistent in MV3. Do not set `background.persistent`; Firefox does not support that MV3 property.
The common runtime selects the browser's native Promise APIs. All targets retain browser-issued
document IDs, top-frame targeting and the same closed worker protocol. Firefox's minimum version
keeps document-ID support; older browsers fail closed.

Chrome retains restricted `storage.local` for existing installed sessions. Firefox stores
refresh credentials in extension-origin IndexedDB because its local storage cannot be made
private from content scripts. Native private `storage.session` still owns access tokens, proofs,
drafts and bindings; nothing falls back to persistent storage. Chrome/Firefox use native identity
sign-in with shared state/PKCE validation.

A Firefox build is not a store publication. Native hosted BotID, screenshot and navigation checks
passed for the exact 0.1.5 CI ZIP. Mozilla approval, signed-store installation and a later automatic
update remain separate gates. Chrome/Edge receipts below apply to those published versions only.

## Accounts and projects

The popup lists matching projects across the signed-in account's workspaces, with each workspace
name, and keeps the picker available during a review. **Switch review** replaces that tab's project.
**Switch account** also works when no project matches: first-party consent shows the browser's live
signed-in accounts and their matching projects before approval. Cancelling keeps the current
extension review; approving an account ends its previous reviews in all tabs and clears private
drafts and proofs. Only the site's origin is sent for discovery, without its path or query.
The extension still holds one account, and server-side project access and exact-origin checks apply
again when starting a review. This behavior requires a new extension store release.

## Updates

The extension packages the toolbar, so toolbar changes reach reviewers only through a store
release. The [daily release automation](browser-extension-release.md#regular-releases) ships toolbar
changes merged to main and skips unchanged days. It never loads the
toolbar from uier.io: stores forbid remotely hosted code, the reviewed page's CSP would block a page
script, and the worker's credentials must stay out of the page. Browsers check the store every few
hours and install a download once the extension is idle, which can wait for a browser restart.

`GET /api/extension/version` reports the newest version on main. When the popup opens, the worker
reads it at most once an hour per browser session (`src/update.ts`). Only when it is newer than the
installed package does the worker call `runtime.requestUpdateCheck()`, the one use Chrome documents
for that API. The worker also records `runtime.onUpdateAvailable`. Once the browser has the
download, the popup shows **Update ready** with **Restart and update**: the worker removes active
toolbars, then reloads the extension so the browser installs it. A restart, like every update,
clears session storage: active reviews, proofs and unsent drafts end, and sign-in remains. A version
still in store review shows nothing. The check uses the existing API host permission and sends no
credentials. Temporary and unpacked installations have no store and never offer an update.

## Local loading

1. Run Node 26 and the pinned Corepack pnpm. Run pnpm install, then pnpm build.
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

### Hosted receipt — 3 November 2026

Native Chrome 156 and Microsoft Edge 156 on macOS exercised the `0.1.1` hosted test build,
development client `gnhfndanmlbcbcnogfojolkdamnlpjjm`, against the real `https://uier.io` API.
The isolated fictional project used `http://127.0.0.1:4017` without an embed. Its CSP denied scripts,
connections, frames, images, fonts and styles. Both browsers blocked third-party cookies without
site exceptions. These runs used no loopback API proxy, local BotID mode or verification bypass.

- Explicit sign-in/consent matched the exact configured project origin and Start review mounted
  the packaged toolbar. Both browsers saved new feedback through production.
- Reload/restoration retrieved saved feedback and its screenshot. Both browsers expanded the
  stored screenshot despite the page's `img-src 'none'`, then replied, resolved and reopened.
- After the original five-minute proof lifetime, Chrome saved a reply through automatic worker
  renewal. Edge obtained a renewed proof on explicit restart and saved its reply. Third-party
  cookies remained blocked throughout.
- Cross-origin redirects ended activation even for another configured address. Back restored the
  original page with no toolbar; explicit Start review was required. Edge also verified valid
  same-origin Back continuation. The package regression asserts actual cached-document identity
  for both cases and fails against the previous runtime.
- Chrome also saved feedback on a fictional cookie-authenticated page, a separately configured
  localhost staging origin and a same-origin SPA route. Both browsers then saved feedback on
  [the controlled HTTPS reviewer demo](https://uier.io/extension-demo.html), whose CSP also denies
  scripts, connections, frames, images, fonts and styles. Chrome retrieved and expanded its saved
  screenshot after reloading that page. All feedback used the isolated acceptance project.

The real hosted design gate has evidence. The [first protected submission](browser-extension-release.md#first-submission-receipt--3-november-2026)
also succeeded. The later [native store-installed receipt](browser-extension-release.md#installed-acceptance-and-first-update--3-november-2026)
records acceptance of the published 0.1.1 package. The later automatic-upgrade receipt records
the real store-delivered 0.1.2 upgrade and post-update acceptance in both browsers.

The app offers script and extension setup in Settings → Installation, with a line in onboarding.
The extension tab links to the verified official store item; until then it is one line and a link to
the setup guide. The script remains the default.
A store link appears only when `UIER_EXTENSION_AVAILABLE=1`, the valid
`UIER_EXTENSION_STORE_ID` also occurs in `UIER_EXTENSION_CLIENT_IDS`, and owners have completed
the hosted and publication gates. Feedback activity is labelled as feedback, never embed-installation proof.

### Public pages

The public [`/browser-extension`](https://uier.io/browser-extension) page and the
[`/guides/browser-extension`](https://uier.io/guides/browser-extension) setup guide (#308) describe
the shared runtime and each browser's release status in the words of the app's setup tab and the
[listing worksheet](browser-extension-listing.md), claiming only what the receipts above record.
The footer, the `/guides` index, the homepage's
get-started card and two FAQ answers link them. They are static, and deploys build without the
hosted settings, so `apps/web/src/lib/extension/release.ts` names the published Chrome store ID,
store button label, popup labels and Firefox availability notice. The homepage, FAQ, extension
pages and app installation guide share that notice. The current store button says **Get for Chrome
or Edge** and uses the same `chromeWebStoreUrl` as the app. Firefox is described as awaiting Mozilla
review, with its minimum version and future store setup steps; no Firefox download is offered yet.
After approval and the store acceptance gates, update this shared release data and both public and
app distribution links together. When a release changes
the store item, labels, permissions, sign-in or capture, update both pages and the privacy policy,
cookie policy and security page's extension sections together; changed legal wording needs owner
review and a new effective date. The setup guide lives with the other guides until the docs hub
(#293) exists.

Native Edge Add-ons distribution, Firefox approval and signed-store rollout, mobile and anonymous
extension access remain separate follow-ups. Safari has no extension target; Safari and mobile
reviewers use the script.
Extension API contract v1 must remain compatible for one year after its last supported release.
A bad store release requires a higher numeric version containing a fix; installed versions cannot
be rolled back by decreasing the version.

## Validation and delivery

PR CI validates production resources, packages a deterministic ZIP/checksum/source receipt and runs
that unchanged ZIP in persistent Chromium. The build refuses axe-core or the on-demand checks in any
entry but `audit.js`; validation requires `audit.js` with axe-core's notice and refuses that notice
in every other resource, and each browser app's tests run its `audit.js` in a fresh context to check
the isolated-world handoff. The local TLS fixture maps the production API hostname to
a disposable loopback proxy, including native identity windows; it never patches the manifest or
bundle and does not contact the production API. The temporary certificate is trusted only by that
browser process's SPKI flag. This verifies the production artifact with local BotID mode, **not real
hosted verification**.

Local acceptance covers real sign-in/consent, multiple project matches, worker transport, strict-CSP
posting/reload, viewport screenshot retrieval/canvas preview, proof renewal, replies, resolve/reopen,
repeated activation, worker shutdown/restart, browser restart with retained sign-in and cleared
activation/drafts, access renewal without cookies, committed-but-lost refresh recovery, concurrent
refresh/logout, draft recovery, committed-but-lost write retries,
same-document project switching, Exit/restart, SPA history, cross-origin deactivation, sign-out,
embed coexistence with a different project, text/area anchors, screenshot redaction, safe inactive-tab
capture failure, omitted API cookies, light/dark popup accessibility, and the Accessibility panel on a
strict-CSP page of over 1,500 elements: `audit.js` is parsed in the document only once the panel opens,
once for Check again too, the panel lists the page's issues, and the page has no `axe`, handoff or script
element and requested nothing for it; a smaller page gets its button's issue count from the background audit.
The runtime test polls the saved comment count after draft submission: optimistic message text
can appear before the worker finishes saving, including a committed-but-lost write retry.
The closed typed worker envelope and shared route contract reject arbitrary URLs/operations,
credential/header injection and malformed payloads. API tests retain current membership, origin,
privacy, comments-off, handoff/PKCE and idempotency coverage. App setup has desktop/mobile keyboard
and light/dark accessibility coverage. Release tests cover tag/main/version checks, reproducible
ZIP bytes, conflicts, bounded async polling, unknown/rejected states and uncertain-write recovery.

The [release runbook](browser-extension-release.md) documents the implemented protected tag/dry-run
and bounded status workflows, Google OIDC/service-account configuration, API v2 receipts, version
support and forward-fix recovery. The [listing worksheet](browser-extension-listing.md) supplies copy,
permission/disclosure drafts and reproducible brand artwork. None enables public rollout.

The protected 0.1.1 upload and submission succeeded, using keyless Google federation and a retained
immutable package. The [submission receipt](browser-extension-release.md#first-submission-receipt--3-november-2026)
records its source, checksum and review status. This successful upload does not exercise the
async-upload reconciliation path; keep its fail-closed behavior and dashboard recovery rules.

Store publication, native acceptance and the automatic 0.1.1 → 0.1.2 upgrade are complete. Both
browsers report the stable item ID and Chrome Web Store source; the old unpacked copies are
disabled. The publisher account and public visibility are verified. Production configuration enables
the app installation link and registers only the stable client. [Deployment 41625585259](https://github.com/signalco-io/uier/actions/runs/41625585259)
succeeded. The live guide's link opens the official 0.1.2 listing, and hosted verification's CSP
contains only the stable store ID. The #268 desktop Chrome/Edge delivery gates are complete.

Future releases retain the protected workflow, tested artifact, hosted acceptance and installed-update gates.
