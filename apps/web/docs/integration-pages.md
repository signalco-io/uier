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
