# Feature pages

`/features/<feature>` pages describe one shipped workflow each, with the shared marketing building
blocks, a static specimen built from the tokens (`TriageSpecimen`, `FixVerificationSpecimen`, `AiSpecimens`),
`publicPageMetadata` with their own path and a page card with the section Features
([social cards](social-cards.md)). Page-level questions use `FaqPanel` from `LandingFaq`.
There is no `/features` index; any other slug is a real 404. Publish a feature page only once the
workflow is deployed to production, with labels and actor rules taken from the delivered controls,
link it from the landing (details or questions) and the footer, and add it to `KnownPages` and to
the public paths in `e2e/seo.api.spec.ts`, `e2e/social-cards.api.spec.ts` and `e2e/footer.spec.ts`.

`/features/feedback-triage` states the shipped bounds from `MAX_PROJECT_COMMENTS` (1,000 threads)
and `MAX_TRIAGE_THREADS` (50), the batch outcomes and the permissions; change the page with them.
Its bulk Done is ordinary completion and never reviewer confirmation: a pending check ends as "Done
without reviewer confirmation" (`@uier/toolbar/verification` labels). It links to
`/features/fix-verification` for the verification workflow rather than describing it.
`e2e/feature-pages.api.spec.ts` covers its metadata, social card and the 404s;
`e2e/feature-pages.spec.ts` its claims, links and accessibility.

`/features/fix-verification` keeps a reviewer's confirmation apart from ordinary and bulk Done (it
links to the triage page for the latter), a connected service's closure and MCP status; change it
with the verification controls and `src/lib/review/fixVerification.ts`.
`e2e/fix-verification-page.spec.ts` covers its copy, links, responsive layout and accessibility.

`/features/ai` covers the MCP connector for coding tools and rewrite suggestions. It offers only the
clients Account offers (`mcp/clients.ts`: Claude Code with browser sign-in, Codex and Cursor with an
access token), the operation labels of `components/app/mcp/scopes.ts`, the prompts of
`mcp/workflows.ts` and what the connector cannot do; change it with them and with
[docs/mcp.md](../../../docs/mcp.md). Approval of each write happens in the coding tool, never in uier, and
MCP never confirms a fix. Its rewrite section follows the toolbar's labels and the privacy policy's
"Rewrite suggestions". The landing links it from the "Let your coding agent fix it" tile (`AgentSpecimen`),
the rewrite line of the details and the coding-agent question. `e2e/ai-page.spec.ts` covers its copy,
links and accessibility; `e2e/feature-pages.api.spec.ts` its metadata and social card.
Its rewrite list and privacy answer also describe admin-saved workspace style guidance and project
additions/replacements ([settings pattern](project-settings.md#workspace-defaults-and-project-settings)).
The settings remain private to admins; the reviewer still supplies their own optional instruction.
