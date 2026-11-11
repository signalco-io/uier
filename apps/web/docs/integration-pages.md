# Integration pages

Public `/integrations` and `/integrations/[provider]` pages use the shared marketing building
blocks and `src/lib/integrations/catalog.ts` for actual provider capabilities, features, configurable
settings and setup steps. The catalog's `features` also render on the project's page for the provider
in the app (`IntegrationFeatures`, with On/Off for two-way status sync and reply sync) and its optional
ones as badges on the app's Integrations cards and chips on the public index. Keep `two-way-status` and
`reply-sync` aligned with the adapters' `supportsStatusSync`/`supportsReplySync`; `e2e/integrations.api.spec.ts`
checks them. Both index pages show `IntegrationLogo`. "Suggest an integration" (`SuggestIntegrationButton`
on the public index, `SuggestIntegration` in the app) calls `openToolbarFeedback()` from `ToolbarScript.tsx`,
which opens uier's own toolbar feedback form: public on the showcase, private on app pages.
Listing illustrations come from `scripts/render-integration-listings.mjs`, existing brand vectors
and Geist fonts. They contain no customer data and are labelled illustrations. Keep permissions,
privacy limits and directory status aligned with the adapters and `docs/integration-publication.md`.
`e2e/integration-pages.spec.ts` covers the public guides, their features and settings, the logos, the suggestion
form, support/setup links and accessibility.

The index's services are tiles in one panel, three to a row on wide screens and two on tablets: the logo, the
name, the catalog's description, its optional features under "Optional" and "Set up <service>", whose link covers the
tile. A sixth tile, "Another tool", links to the suggestion section below, so every row is full; keep the count a
multiple of two and three when services change.

The index's cover (`integrations/IntegrationsCover.tsx`, the page's one moving picture) is a loop under the header:
a shared thread, the five services in one panel and a hairline between them. The thread is copied to each service
(the item and its state badge come in as its line arrives), a reply comes back from Linear named the way
`importReplies.ts` names imported replies ("Ana via Linear"), and Done updates each copy (GitHub says Closed). Change
it with the catalog: it shows only what the services do. It follows the landing scene's rules: built from the tokens
and the landing's thread pieces, plays only in view, Pause under it with a caption, one still frame with reduced
motion, a fixed height per breakpoint. The picture and its caption are `inert` and `aria-hidden`, so the axe scan
skips their text, which a frame can catch mid-fade; the canvas is `data-uier-decorative` with a `min-height`. It is
self-contained: the other marketing pages' covers do not share it.
