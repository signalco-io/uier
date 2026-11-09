# Browser extension runtime

`src/lib/extension` and `/api/extension` use separate revocable sessions: updated packages request
`renewable: true` for 15-minute access, rotating refresh with 30-day inactivity and one-year absolute
limits. Legacy packages retain eight-hour sessions. Refresh uses atomic session/token replacement,
hashed credentials and persisted attempt hashes: exact retries return the same derived successor,
different-attempt reuse revokes the session. Known refresh credentials can revoke after access expiry.
Project/exact-origin credentials last five minutes. `UIER_EXTENSION_CLIENT_IDS` remains the explicit
Chromium allowlist. Firefox and Safari use `UIER_EXTENSION_CLIENTS`, a JSON array of
`{ id, browser: 'firefox' | 'safari', redirectUri }` registrations, disabled by default. Invalid or
duplicate registrations disable the additional clients without changing the Chromium allowlist.
Firefox's stable client is `uier@signalco.io`; register the exact HTTPS URL returned by
`browser.identity.getRedirectURL()` (including its trailing slash). Safari's logical client is
`io.uier.safari.Extension`; register `https://uier.io/extension-callback`, or the exact API origin's
equivalent. Only local runtime permits `http://127.0.0.1:<port>/extension-callback`.
Registration grants transport only, never identity or BotID bypass. Recheck current
membership, session and addresses before calling shared review services. Keep embed CORS unchanged.
`/app/extension` is explicit consent after first-party sign-in. `/extension-verification` is a
nonce-protected frame for the packaged helper. Firefox and Safari send their current extension
origin during authorization; the one-use handoff, session, access token and project scope bind that
origin. Only UUID origins in the registered browser's extension scheme are accepted. Refresh
possession can rebind the origin because Safari can assign a new UUID after restarting; old access
and project scope tokens then fail. Retry recovery preserves the same successor and expiry.
The helper supplies `clientId` and `extensionOrigin` query parameters. Server validation sets one
exact `frame-ancestors` origin, the frame checks its actual message parent, and the verification
endpoint compares that origin with the signed scope and live session. Existing Chromium helpers
without these parameters retain their registered Chrome origins. Extension-family CORS permits
transport from syntactically valid enabled extension origins, while all identity still requires a
live token. No web origin gets that transport grant.
Safari uses a dedicated first-party sign-in tab because its extension API has no identity flow.
`/extension-callback` contains no client providers or analytics, sends `no-store`, `no-referrer` and
`noindex`, and never reads or renders its transient state/code. The worker observes only the tab
it created and validates the exact callback, state and PKCE before exchanging the code.
No app cookie reaches the worker. Read [the design and remaining gates](../../../docs/browser-extension.md).

Installation uses the script/extension tabs in InstallGuide. Keep Check installation inside the
script tab; comment activity does not prove embed installation. BrowserExtensionGuide reads the
server-only distribution gate (UIER_EXTENSION_AVAILABLE=1, valid STORE_ID also in CLIENT_IDS).
Never invent a store URL or enable it without hosted/store acceptance.

`public/extension-demo.html` is an unindexed, deliberately plain reviewer fixture without the
marketing layout, embed, scripts or styles. Its exact-path proxy policy denies all page resource
loads. Keep it free of customer data and sign-in secrets; reviewers create their own isolated
project. The API check preserves that boundary; the browser check scans its content directly
because the ordinary public-page accessibility helper waits for a showcase toolbar.

The public `/browser-extension` page and the `/guides/browser-extension` setup guide describe the
published 0.1.2 extension. Their copy follows BrowserExtensionGuide, the listing worksheet, the
popup (`packages/extension/src/popup.tsx`) and the receipts in `docs/browser-extension.md`; popup labels
and the published store ID live in `src/lib/extension/release.ts` (static pages build without the
hosted `UIER_EXTENSION_*` settings). The store button uses the same `chromeWebStoreUrl` as the app's
link. Recheck both pages, and the legal pages' extension sections, when a release changes labels,
permissions, sign-in or capture. `browser-extension.api.spec.ts` checks the store link and
`browser-extension.spec.ts` their content.

`/browser-extension` lists the supported browsers under the hero: desktop Chrome and Microsoft Edge
from `minimumBrowserVersion`, nothing else until the manifest supports it; the "Where it works"
section keeps the unsupported browsers and pages. Its pictures (`ExtensionSpecimens`) are the popup
in its "Review this site" state and the expanded review toolbar on the landing page's example site,
built from the tokens and hidden from assistive technologies, never screenshots or generated
images. Change them with `packages/extension/src/popup.tsx` and the toolbar's `CommentToolbar`.

The shared broker contract also permits `GET comments/<id>/replies/<itemId>/screenshot`. This read uses
the scoped project's current membership and parent-thread visibility through `getReviewScreenshot`;
it never dispatches to reply deletion. Image uploads use the existing verified reply POST and sanitizer.
`e2e/extension.api.spec.ts` covers the closed read-only route, image bytes, revoked membership,
browser registrations, exact callbacks, bound extension origins, refresh rebinding and exact helper
ancestors. Public installation links remain subject to each browser's publication and acceptance
gates; local browser builds do not announce new store availability.
