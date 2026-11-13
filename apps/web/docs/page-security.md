# Page security and cookie migration

`proxy.ts` overwrites incoming CSP and nonce headers and generates 128 random bits per request
for `/app` pages and the two verification bridges. Next applies the forwarded CSP nonce to request-rendered scripts. The app's static
shell allows same-origin script bundles and exact SHA-256 hashes for `themeScript.ts` and React's
fixed shell-timing script; it uses
neither `unsafe-inline` nor `strict-dynamic` for scripts. Same-origin parser-inserted bundles are
allowed deliberately because their prerendered tags cannot carry a per-request nonce. Preview and
development hosts remain explicitly scoped. Inline event handlers are denied with `script-src-attr`.
`ClientProvider` makes next-themes' own inline initializer inert (`application/json`) and the app
root layout emits the shared hash-authorized initializer before the page content. It skips both
verification bridges without reading theme storage. Theme changes still use next-themes.
App HTML and private data stay `no-store`; [Cache Components](cache-components.md) describes the shells.
Session identity, recent-sign-in/email-proof checks and browser account menus wait for `connection()`
before checking expiry or migration deadlines. A prefetched shell must not freeze those clock-based
authorization decisions. Unknown public integration guides are rejected in Proxy before their URL-specific
content streams, preserving HTTP 404; the page independently validates its provider for RSC navigation.
The internal unavailable entries live under `(rest)/(app-errors)`, outside the app's request-language
layout, so their synchronous `notFound()` fixes HTTP 404 before localized content streams. Proxy still
uses the same paths and access preflight; pages/actions/APIs retain their own checks. The generic
error retains its request nonce marker and the review error retains its account-switch return address.

The verification bridges keep Next's client instrumentation (`instrumentation-client.ts`) so BotID
initializes before their protected proof requests. They have no app/theme/analytics providers.
`/review-verification` has a request marker beneath Suspense so its resume scripts carry the nonce;
`/extension-verification` streams its validated query configuration beneath its existing text.
Both use the same static-shell script policy. The fixed `/review-session` script keeps its stricter
hash-only policy (`review/sessionDocument.ts`) and loads no Next resources.
`/extension-verification` is frameable only by its registered helper;
its `clientId`/`extensionOrigin` query selects one exact, validated extension origin. Legacy
Chromium helper requests retain the registered Chrome origins. No extension-scheme wildcard is
used. Case variants get deny/`frame-ancestors 'none'`.

Public pages deliberately retain static rendering and `script-src 'unsafe-inline'`: their generated
Next bootstrap and theme scripts vary by build. We do not apply request nonces to cached HTML.
Keep providers in the marketing/app layouts so a root `headers()` call does not turn the public site
dynamic. Vercel Web Analytics collection is disabled by the owner (3 November 2026); `ClientProvider` does
not inject its SDK. The existing analytics CSP sources remain available for a future explicit setup. Vercel toolbar/frame/Pusher hosts apply only to
`UIER_DEPLOYMENT_ENV=preview` (set at build time). Clipboard permissions are left alone.
COOP is `same-origin` on public pages and `same-origin-allow-popups` across the app, including
`/app/review`: the installation check retains its WindowProxy when the popup redirects cross-origin.
The app needs that policy from its initial document, including sign-in, because client navigation
keeps COOP. `DocumentPolicyBoundary` in `ClientProvider` uses full document navigation for links
crossing between public pages and `/app`, so both CSP and COOP change with the destination.
BotID's custom headers allow same-origin scripts, workers, fetches and framing, with no inline scripts.
`botIdProxy.ts` applies that same policy after fetching the response: Next's external rewrite proxy
discards configured response headers. The local test-only upstream uses the existing API stub.
HSTS is one year with subdomains. Do not add `preload` or submit to the preload list until an owner
has observed this policy operating successfully.

Explicit screen recording uses `display-capture=(self)` on uier pages; camera and microphone
remain disabled. BotID responses retain `display-capture=()`. Recording previews use memory-only
`blob:` URLs. Playback permits only the same origin and the exact configured Azure Blob origin
in `media-src`, also included in the generated embed CSP snippet. The install guide's `connect-src`
permits direct recording uploads to that origin. A reviewed site's own Permissions-Policy can
still disable capture; file upload remains available when browser capture is unavailable.

`src/lib/cookieNames.ts` centralizes HTTPS `__Host-` / `__Secure-` names, local HTTP names and
lifetimes. `__Host-uier_comments_view` is a browser-readable, Secure, SameSite=Lax presentation
preference with Path=/ and a one-year lifetime; only `list` and `board` are accepted. It grants no
access and is read request-scoped. The local HTTP name is `uier_comments_view`.

The registry also defines bounded legacy reads. The fixed migration cutoff is 30 October 2026 UTC; legacy sign-in bindings
stop being accepted 15 minutes later, session/SSO cookies after 30 days, visitor/workspace cookies
after 365 days. Never reset this date on a rebuild. Prefer the new name even when its value is
invalid; do not resurrect a legacy identity. New writes use only the chosen current name; sign-out
expires both names so fallback cannot undo it. Remove the migration branches after their deadlines.

The multi-account credentials `__Host-uier_account_1` through `_4` are new cookies: their
unprefixed names work only in local HTTP runtime, without a deployed legacy fallback. Only the
active `__Host-uier_session` authorizes app/API requests; selecting a parked credential validates
its signature, purpose, original expiry and live user. Switching keeps its original recent-sign-in
and email-proof claims. Sign-out clears current and legacy active cookies so migration cannot
restore an account. `__Secure-uier_review_sso` continues to use its own purpose and review-only
path; an explicit final sign-out writes a `review-sign-out` marker which authorizes no identity.
The marker lets a foreground toolbar clear its saved review identity when third-party cookies are
available; blocked cookies/frames retain the explicit authenticated review-link flow.

Project-link account offers use only validated live browser sessions and current project/team membership. Selection repeats those checks before writing account/workspace cookies. Ordinary APIs and screenshot routes never try parked accounts. Unknown targets receive the existing 404 without account hints.
