# Browser extension runtime

`src/lib/extension` and `/api/extension` use separate revocable sessions: updated packages request
`renewable: true` for 15-minute access, rotating refresh with 30-day inactivity and one-year absolute
limits. Legacy packages retain eight-hour sessions. Refresh uses atomic session/token replacement,
hashed credentials and persisted attempt hashes: exact retries return the same derived successor,
different-attempt reuse revokes the session. Known refresh credentials can revoke after access expiry.
Project/exact-origin credentials last five minutes. UIER_EXTENSION_CLIENT_IDS is an explicit allowlist; disabled by
default. It grants transport/registration only, never identity or BotID bypass. Recheck current
membership, session and addresses before calling shared review services. Keep embed CORS unchanged.
`/app/extension` is explicit consent after first-party sign-in. `/extension-verification` is a
nonce-protected frame for the packaged helper; only registered extension origins may frame it.
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
popup (`apps/extension/src/popup.tsx`) and the receipts in `docs/browser-extension.md`; popup labels
and the published store ID live in `src/lib/extension/release.ts` (static pages build without the
hosted `UIER_EXTENSION_*` settings). The store button uses the same `chromeWebStoreUrl` as the app's
link. Recheck both pages, and the legal pages' extension sections, when a release changes labels,
permissions, sign-in or capture. `browser-extension.api.spec.ts` checks the store link and
`browser-extension.spec.ts` their content.

The shared broker contract also permits `GET comments/<id>/replies/<itemId>/screenshot`. This read uses
the scoped project's current membership and parent-thread visibility through `getReviewScreenshot`;
it never dispatches to reply deletion. Image uploads use the existing verified reply POST and sanitizer.
`e2e/extension.api.spec.ts` covers the closed read-only route, image bytes and revoked membership.
