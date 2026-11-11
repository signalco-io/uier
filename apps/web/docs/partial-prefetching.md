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

Final adoption checks passed: nine locked production cases on desktop/mobile/tablet; 43 focused
integration, navigation, Status and account-session checks; `pnpm typecheck`, both ordinary and
dedicated production builds; and the short `pnpm test` run (1,059 passed, one pre-existing real-Cosmos
conditional test skipped without its account). The ordinary build records the testing API as false.
The production browser demonstration held both Status regions, then verified their live content after
release. The integration 404 preflight explicitly preserves published illustration files and Next's
generated metadata-image paths; the social-card API suite verifies those images still respond.
