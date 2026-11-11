# Cache Components

`next.config.ts` enables Cache Components on Next.js 16.4. Partial Prefetching is explicitly off;
its link and navigation migration is separate work. There are no `instant = false` exceptions.
The version-matched migration and API docs ship in `node_modules/next/dist/docs/`.

## Rendering and data

Public content, navigation, footer and social cards prerender. `/status` keeps its header and
explanation static and streams the live summary and service checks. Both readers wait for a request
before using the existing 30-second status snapshot. `/api/status` does the same and retains its
200/503 contract and `no-store`. `/notifications` streams token inspection and its form beneath a
static header; neither tokens nor preferences enter a shared cache.

App layouts and pages put their request reads beneath explicit Suspense boundaries. Auth pages keep
their logo, card and legal links in the shell. The signed-in shell initially shows its sidebar and
inset-panel placeholders; personalized navigation and page content replace them. Nested project,
workspace and account segments have their own boundaries, so an existing layout can remain visible
while the destination loads. `PageLoading` uses the UI kit's skeletons with fixed dimensions and an
accessible status label. No private names, permissions, comments or form values are prerendered.

`pageAccess.ts`, called by Proxy for document requests, completes session, project, author-filter,
team/person and settings access decisions before streaming. Redirect-only entries, including workspace,
onboarding, legacy install and client links, keep HTTP redirects. Repeated query keys retain the pages'
array semantics. This preserves document redirects and 404s. Denied pages rewrite
to internal `/app/unavailable` or `/app/review-unavailable` error shells. Their synchronous
`notFound()` decisions persist HTTP 404 in the prerender metadata before anything streams.
The review-specific shell retains the account hint and original-address account-switch link. The
generic error shell uses a request marker to give resume scripts the request nonce without making
the public 404 or marketing pages dynamic. RSC redirects and Server Actions stay under Next's
protocol and their own checks, rather than being intercepted by document preflight. Pages, metadata, APIs and
server actions still perform their own authorization; the preflight never grants data access.
`requestContext.ts` shares workspace-selection rules without depending on Next's render context.

API handlers retain their request reads and response cache policies. `appBaseUrl()` reads request
headers before resolving its unconfigured-runtime error, so builds stop at that request boundary.
OAuth metadata explicitly reads the request before consulting runtime configuration. Legacy
`dynamic`, `dynamicParams` and `runtime` exports are removed; Node.js is the default. Unknown social
card ids still return 404 through the existing explicit allowlist.

## Cache boundaries and writes

Only two new shared caches exist:

- `SiteFooter`: `cacheLife('hours')`, including its copyright year.
- `socialCardFonts`: `cacheLife('max')`, immutable font files from the pinned Geist dependency.
  Fonts cross the cache boundary as ArrayBuffers so the image renderer receives the same bytes.

Neither contains mutable application data or needs mutation invalidation. Account, workspace,
project, permission, comment, notification and usage data remain request-scoped. Existing React
`cache()` calls deduplicate only a render. Existing actions keep their `revalidatePath` calls and
return fresh RSC data; do not add a second browser refresh after them. A future mutable shared cache
must have scoped keys/tags and a verified write-then-read invalidation path before it is introduced.

## Security and verification

See [page security](page-security.md) for the static-shell CSP and the verification
bridges and their BotID instrumentation. The app keeps `no-store`; only public content and immutable assets are shared.

Run `pnpm typecheck`, `pnpm build` and the short `pnpm test` suite. Focused coverage includes
`landing.spec.ts` (CSP, inline injection, document-policy navigation), `app.spec.ts`,
`app-navigation.spec.ts`, `app-performance.spec.ts`, `account-sessions.api.spec.ts`,
`status.spec.ts`, `social-cards.api.spec.ts`, `review-sso.api.spec.ts` and `extension.api.spec.ts`.
Check desktop, mobile and tablet layouts when changing shell geometry. Runtime verification uses
Next.js MCP plus an isolated browser session, including authenticated navigation and mutations.
Keep the dev and production-test servers on separate ports.

The internal error entries deliberately throw `notFound()` before rendering. Next's dev-only
instant validator reports that it cannot validate those entries when a denied request reaches them.
This is an error-route diagnostic, not a deferred product route; their production prerender metadata
and HTTP responses retain 404. No validation is disabled for the app.
