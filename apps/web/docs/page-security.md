# Page security and cookie migration

`proxy.ts` overwrites incoming CSP and nonce headers and generates 128 random bits per request
for `/app` pages and the exact `/review-verification` bridge. Next applies the forwarded CSP nonce
to framework scripts; the app layout reads `x-nonce` and passes it to `ClientProvider` / `ThemeProvider`.
Those pages render dynamically with `no-store`. The verification bridge has no app/theme/analytics
providers. The fixed `/review-session` script and its SHA-256 source share `review/sessionDocument.ts`.
`/extension-verification` is also nonce-protected and frameable only by its registered helper;
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

`src/lib/cookieNames.ts` centralizes HTTPS `__Host-` / `__Secure-` names, local HTTP names and
bounded legacy reads. The fixed migration cutoff is 30 October 2026 UTC; legacy sign-in bindings
stop being accepted 15 minutes later, session/SSO cookies after 30 days, visitor/workspace cookies
after 365 days. Never reset this date on a rebuild. Prefer the new name even when its value is
invalid; do not resurrect a legacy identity. New writes use only the chosen current name; sign-out
expires both names so fallback cannot undo it. Remove the migration branches after their deadlines.
