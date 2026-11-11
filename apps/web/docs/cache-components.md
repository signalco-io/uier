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

Two client-navigation shells reuse the already-resolved app language instead of waiting for another
server language read. Projects → Create project shows the heading, instructions and onboarding
progress before the authorized form and client suggestions stream. Projects → Account shows the
Account heading and all five section links before its email and section forms stream independently.
`NewProjectHeader` and `AccountFrame` use the existing language provider; they import no catalogs or
account services. `OnboardingSteps` uses that same provider on creation and installation pages.
The completed markup, responsive containers and data sources stay the same. Account navigation and
focus survive the email/form reveal. These are soft-navigation improvements: initial signed-in
documents still wait at the outer request-language and personalized-shell boundaries.

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

The two internal error entries live in `(rest)/(app-errors)`, whose layout has no request reads.
Their synchronous `notFound()` decisions must run before the language boundary can stream; placing
them beneath `(app)/layout` would otherwise turn denied documents into HTTP 200 loading shells.
Their not-found content resolves `AppLanguage` inside its own Suspense boundary, retaining localized
copy, noindex, providers, the review account hint/return address, and the generic nonce marker.
This repairs a pre-existing 200 response reproduced with both route optimizations reverted.

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

### Meaningful instant UI regression tests

[`../instant-nav.rig.md`](../instant-nav.rig.md) records the production-build rig and the exact
navigation, authentication and data contracts. `PORT=4314 pnpm test:instant` builds a disposable
artifact with the opt-in testing API and runs all 15 `@next/playwright` assertions across desktop,
mobile and tablet. Empty and populated workspaces use the real local sign-in and project actions.
The tests require headings/navigation plus their existing loading states, with private content absent
under the lock and present after release. Account links retain keyboard focus through the stream.
The unchanged `/status` hard-load contract checks both independently suspended live regions; it
already meets its useful-shell contract and needs no optimization.

`playwright.instant.config.ts` rejects an artifact without the testing API and opts in the test server
as well as the build. Ordinary builds exclude the API; VERCEL, VERCEL_ENV or UIER_DEPLOYMENT_ENV also
force it off even if UIER_INSTANT_TEST is set. Turbo hashes those inputs. CI's browser job first builds
an ordinary artifact for browser/security essentials, then builds a separate disposable artifact with
the flag immediately before this dedicated suite. Next's test-only inline bootstrap must not affect
ordinary CSP verification; the production policy and security assertions remain unchanged.
Regular `pnpm test`/`test:full` exclude the dedicated-build spec.

The optimizer differential changes only the two route entry files: moving their stable UI back behind
the original server awaits makes all 12 optimized navigation/variant/viewport cases fail at the
heading assertion, while the three status controls pass. Restoring the focused boundaries makes all
15 pass. Unlocked baselines established each real destination and data variant before that comparison;
the baseline scaffold is not shipped. Test runs attach locked and completed PNGs for visual review.
This is a content-readiness guarantee, not a measured latency claim.

Other reviewed candidates stay request-scoped: project/workspace headings and tabs depend on private
names or permissions; My work reads fresh assignments; auth pages
already expose their card and legal shell. No new shared cache was introduced. Partial Prefetching
remains off; evaluating URL-specific prefetch value and server cost is separate follow-up work.

The internal error entries deliberately throw `notFound()` before rendering. Next's dev-only
instant validator reports that it cannot validate those entries when a denied request reaches them.
This is an error-route diagnostic, not a deferred product route; their production prerender metadata
and HTTP responses retain 404. No validation is disabled for the app.

## Client bundle boundaries

Keep client entry-point splits inside the existing server Suspense boundaries. Pages still resolve
their request data inside their `PageContent` component; a narrower form import must not move those
reads into the prerendered shell. `ClientProvider` keeps next-themes' inline initializer inert and
wraps the development toolbar in Suspense while public notifications have their own entry point.
The Board retains its synchronous client entry and server rendering inside the project page's
request boundary. Its sort schema stays separate from browser choices and validates every board
column, including Archive.
