# Partial Prefetching

Next.js 16.4.5 has `cacheComponents: true` and `partialPrefetching: true`.
Default Next Links prefetch one reusable App Shell per route. Explicit `prefetch={true}`
can additionally resolve cached URL-specific UI. Private application data stays request-scoped.

## Adoption inventory

The audit covers `apps/web/app`, `apps/web/src` and all shared packages: direct `next/link`
imports and exports, bare props, expressions, object spreads, custom wrappers and imperative calls.
There are **zero effective `prefetch={true}` Links** and **zero `router.prefetch()` calls**.
No legacy full-prefetch preservation cases were invented. `LinkTabs` is the only production
`prefetch` prop: `query ? false : undefined`. Its roving props contain only data attributes and tabIndex.

| Navigation / source | Immediate result | After navigation |
| --- | --- | --- |
| Sidebar `NavItem`, `ProjectItem`, `GroupLinkAction`; account menu and breadcrumbs | Existing layout and destination loading UI | Authorized names, counts and page data |
| Project/workspace/account `LinkTabs`, `SettingsLayout`, page/form links | Shared shell with existing loading boundaries | Fresh permitted forms and records |
| `LinkTabs` with `query` (Projects Active/Done) | Existing local view; `prefetch={false}` | URL changes locally; no server work |
| Public `PageNav`, `SiteFooter`/`Footer1`, signalco Link/Button | Public navigation, footer and static content | Live Status checks; URL-specific guide content |
| `InlineLink`, integration tiles, external links, OAuth starts, review-code links | Existing document navigation | Existing destination behavior |

The pinned signalco Link forwards props to Next Link without a prefetch default; Button forwards
its href/props to that Link, and PageNav supplies only href. App Base UI `render={<Link />}`
composition supplies no prefetch override. The toolbar's esbuild alias replaces `next/link` with
its own plain anchor, so its buttons do not initiate Next prefetches. Neither extension runtime
introduces an imperative prefetch. There are no forwarded `LinkProps` policies to migrate.

Query-only opt-outs remain useful: their data is already on the page. OAuth and review-code
document boundaries remain deliberate. Public/app document-policy crossings retain CSP and COOP.

## Rendering and freshness

`/integrations/[provider]` puts its params read behind Suspense with a useful Integrations header
and loading status. The five catalog guides remain statically generated. Unknown provider document
requests receive 404 before streaming; the page retains its independent catalog check.
Session reads wait for the navigation's `connection()` before clock-based expiry checks. No shared
mutable-data cache, cache lifetime, provider activation or additional full-prefetch policy is introduced.

A project's loading state (`ProjectLoading`, the project layout's fallback in the App Shell) renders the real project
tabs every project has. They read the project from the address with `useParams`/`usePathname`, which the router
resolves on a client navigation without a server read, so the shell stays URL-independent and private-data free; the
Install tab and the header wait for the navigation's authorized read
([uier #439](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_K_yAq5Ee4WzEjnCBNx_2z)).
No Link policy changed; `partial-prefetching-optimizer.spec.ts` checks the tabs under the lock.

## Verification

See [the production rig](../instant-nav.rig.md). The flag-off build and complete nine-case shell
suite passed before enabling the flag or changing destinations: `UIER_INSTANT_TEST=1 pnpm build`,
then `PORT=4404 pnpm -C apps/web exec playwright test --config=playwright.instant.config.ts`
(exit 0, 9 passed). These extra default-link checks are regression coverage, not legacy full-prefetch cases.
The first-party `@next/codemod@16.4.5 remove-partial-prefetch ./app --force` processed all 287
app files: zero errors, 287 unmodified, no temporary partial route exports.

The route queue comes from all 74 `app/**/page.tsx` files and Next's MCP route map. Development
verification covers public pages, all five integration providers, auth/error pages, account sections,
workspace tabs, real user/team detail, project creation/onboarding, comments, page checks and every
project settings/provider page. Empty and populated local workspaces use real email-code accounts and
actions. Error/internal entries deliberately throw notFound and retain their documented validation
diagnostic. OAuth consent and sign-in provider link pages are checked in their unavailable/error state;
provider success journeys use the existing local stub suites. No production credentials or data are used.

Production checks verify actual Links with `instant()`, final pathname/query, fresh content after
release, authentication, document redirects/404s, mutations and navigation continuity. A quiet dev
log alone is not evidence of production prefetching. No mutable cache was added, so no new cache
invalidation lifecycle is required. Follow-up URL-specific enhancements belong in a separate PR.

Final adoption checks passed: all 24 shared locked production cases on desktop/mobile/tablet;
42 focused integration, navigation, Status, HTTP and tablet checks plus two localized denied-document
cases; `pnpm typecheck`, both ordinary and dedicated production builds; and the short `pnpm test`
run (1,059 passed, one pre-existing real-Cosmos conditional test skipped without its account).
The ordinary build records the testing API as false. The shared suite includes the merged Cache
Components shell optimizations; denied review documents retain HTTP 404, the account hint and return URL.
The production browser demonstration held both Status regions, then verified their live content after
release. The integration 404 preflight explicitly preserves published illustration files and Next's
generated metadata-image paths; the social-card API suite verifies those images still respond.

CI runs security/browser essentials on the ordinary production artifact before building the
dedicated navigation-test artifact. Next's testing bootstrap injects inline scripts, so using that
artifact for the production CSP audit would test a different script inventory. Keep the strict CSP
assertions and production allowlist unchanged; do not authorize test instrumentation in user builds.

## Optimization assessment

The optimizer assessment started from main after adoption PR #646 actually merged, including the
Cache Components shell changes from PR #647. It found no safe additional per-link policy change.
The bounded contracts below passed both unlocked and locked runs on the same Next 16.4.5 production
artifact (nine cases in each run across desktop, mobile and tablet). Because the desired contracts
were already satisfied, no application optimization, artificial RED, or revert-only-optimization
differential was appropriate. The final tests retain the real Links and their existing hrefs.

- Projects **Active → Done**: the Done list and Projects heading are immediate at
  `/app/projects?status=done`; the Active list is hidden. Both datasets already exist locally.
  Keep the query-only `prefetch={false}` policy. Back, Forward and reload preserve the selected view.
- Projects **Done → Active**: keyboard Enter reaches `/app/projects` with the Active list visible,
  Done hidden and link focus retained. Keep the same local policy; direct reload stays Active.
- Projects **project card → Project**: keep the default viewport-prefetched shell and loading
  status. Private project data waits for navigation. After the source page loads, another page
  renames the project through its settings form; the destination and direct reload show that fresh
  name, with HTTP 200 and no-store. The lock hides the name and release reveals it, independently
  proving that the production testing API is engaged.

Other candidates were checked and left with their existing policy:

- Public static pages, Account and Create project already expose their intended shell content.
  Status's live checks retain their navigation-time freshness and independent loading regions.
- The five integration guides use a code-owned static catalog, but index tiles are document
  anchors and app Guide links cross the public/app document-policy boundary. Adding RSC prefetches
  or changing those anchors would not establish a useful benefit for those document navigations.
- Project, workspace, team, user and account records remain authorized, request-scoped reads.
  There is no established shared mutable-data freshness contract that justifies caching them to
  make full-prefetch Links useful. No new cache, lifetime, server-invoking Link or manual prefetch
  call was introduced. No new invalidation lifecycle or provider request budget is needed.

`partial-prefetching-optimizer.spec.ts` adds one regression per exact contract to the existing rig,
with immediate/completed screenshots attached. Its tests are excluded from ordinary production
browser runs and run only against the explicit testing build. The optimizer outcome is verified
existing behavior and freshness coverage, with no claimed latency or request-count improvement.

Final optimizer verification passed: all 33 shared production navigation cases, six focused
desktop/mobile project-state, tab and settings checks, `pnpm typecheck`, ordinary and dedicated
production builds, and short `pnpm test` (1,059 passed; the same real-Cosmos conditional skip).
The ordinary artifact has Partial Prefetching enabled and the testing API disabled.
